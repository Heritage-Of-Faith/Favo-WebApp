"use client";

// Single-screen POS workspace — owner: Mine
// Left panel: build order  |  Right panel: live queue (accordion cards)
// Zero page navigation — everything lives on this one screen.

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { signOut } from "@/server/actions/auth";
import { searchCustomer } from "@/server/actions/customers";
import { getMenu } from "@/server/actions/menu";
import { getActiveBeanLot } from "@/server/actions/inventory";
import { createOrder, transitionOrder, cancelOrder, applyStaffDiscount } from "@/server/actions/orders";
import { useOrderStream } from "@/hooks/useOrderStream";
import { useDraftOrder, lineKey } from "@/store/draftOrder";
import { formatZar, formatDate } from "@/lib/format";
import { freshness, daysSinceRoast } from "@/lib/status/freshness";
import {
  Search, X, Plus, Minus, Trash2, ChevronDown, ChevronUp,
  Loader2, Wifi, WifiOff, RefreshCw, Coffee, LogOut,
  CheckCircle, AlertCircle, Tag, Star, ShieldCheck, Wallet, Package,
} from "lucide-react";
import WalletTopUpDialog from "@/components/pos/WalletTopUpDialog";
import PackPurchaseDialog from "@/components/pos/PackPurchaseDialog";
import { toast } from "sonner";
import ActiveBeanCard from "@/components/pos/ActiveBeanCard";
import StaffPushOptIn from "@/components/pos/StaffPushOptIn";
import StockBadge from "@/components/pos/StockBadge";
import StockBanner from "@/components/pos/StockBanner";
import WasteDialog from "@/components/pos/WasteDialog";
import ConnectivityPill from "@/components/pos/ConnectivityPill";
import SyncDrawer from "@/components/pos/SyncDrawer";
import CustomerCard from "@/components/pos/CustomerCard";
import LoyaltyRedeemDialog from "@/components/pos/LoyaltyRedeemDialog";
import OfflineBanner from "@/components/pos/OfflineBanner";
import DeferredPaymentNotice from "@/components/pos/DeferredPaymentNotice";
import { useStockStatus } from "@/hooks/useStockStatus";
import { useOfflineOutbox } from "@/hooks/useOfflineOutbox";
import type { LogWasteInput } from "@/server/actions/waste";
import type { Customer, MenuItem, MenuCustomisation, Order, OrderState, InventoryLot } from "@/lib/types";
import WasteLogModal from "@/components/pos/WasteLogModal";

// ─── Constants ────────────────────────────────────────────────────────────────
const STATE_LABEL: Record<OrderState, string> = {
  ordered: "Waiting", in_progress: "Making", ready: "Ready ✓",
  collected: "Collected", cancelled: "Cancelled",
};
const STATE_CARD: Record<OrderState, string> = {
  ordered:     "border-cool-steel/30",
  in_progress: "border-[var(--color-warning)]/50",
  ready:       "border-[var(--color-success)]/60",
  collected:   "border-cool-steel/10 opacity-40",
  cancelled:   "border-[var(--color-error)]/20 opacity-30",
};
const STATE_DOT: Record<OrderState, string> = {
  ordered:     "bg-cool-steel/50",
  in_progress: "bg-[var(--color-warning)] animate-pulse",
  ready:       "bg-[var(--color-success)]",
  collected:   "bg-cool-steel/30",
  cancelled:   "bg-[var(--color-error)]/40",
};
const STATE_BADGE: Record<OrderState, string> = {
  ordered:     "bg-coffee-bean/8 text-cool-steel",
  in_progress: "bg-[var(--color-warning)]/20 text-[var(--color-warning)]",
  ready:       "bg-[var(--color-success)]/20 text-[var(--color-success)]",
  collected:   "bg-coffee-bean/5 text-cool-steel",
  cancelled:   "bg-[var(--color-error)]/10 text-[var(--color-error)]",
};
const STATE_NEXT: Partial<Record<OrderState, OrderState>> = {
  ordered: "in_progress", in_progress: "ready", ready: "collected",
};
const ADVANCE_LABEL: Partial<Record<OrderState, string>> = {
  ordered: "Start Making", in_progress: "Mark Ready", ready: "DONE — Collected",
};
const STATE_PRIORITY: Record<OrderState, number> = {
  ready: 0, in_progress: 1, ordered: 2, collected: 3, cancelled: 4,
};
const CATEGORY_LABEL: Record<string, string> = {
  coffee: "Coffee", tea: "Tea", cold_brew: "Cold Brew",
  food: "Food", merchandise: "Merch", other: "Other",
};

type Props = { staffName: string; staffId: string };

export default function POSWorkspace({ staffName, staffId }: Props) {
  const router = useRouter();

  // ── Left panel ─────────────────────────────────────────────────────────────
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("");
  const [modTarget, setModTarget] = useState<MenuItem | null>(null);
  const [selectedMods, setSelectedMods] = useState<MenuCustomisation[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [_yocoSecret, setYocoSecret] = useState("");
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
  // M18 — loyalty redemption on the payment step (order already in `ordered`).
  const [paymentOrderId, setPaymentOrderId] = useState<string | null>(null);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemed, setRedeemed] = useState(false);
  // M19 — offline deferred-payment mode on the payment panel.
  const [offlineDeferred, setOfflineDeferred] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [activeBeanLot, setActiveBeanLot] = useState<InventoryLot | null>(null);

  // Customer search
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Customer[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { customer, items, totalZar, setCustomer, addItem, removeItem, updateQuantity, reset } = useDraftOrder();

  // ── Inventory awareness (M9) ────────────────────────────────────────────────
  const { menuItemStock, outOfStockItems } = useStockStatus();

  // ── Offline outbox — IndexedDB queue + auto-sync on reconnect ──────────────
  const { pendingOrders, pendingCount, syncing, queueOrder, sync, syncOne, refresh } = useOfflineOutbox(staffId);
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false);

  // ── Right panel — queue with full orders ───────────────────────────────────
  const { activeOrders, status } = useOrderStream();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fullOrders, setFullOrders] = useState<Record<string, Order>>({});
  const [advancing, setAdvancing] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<Record<string, string | null>>({});
  const [showDiscount, setShowDiscount] = useState<string | null>(null);
  const [discountId, setDiscountId] = useState("");
  const [discountMsg, setDiscountMsg] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null);
  const [wasteOpen, setWasteOpen] = useState(false);
  const [wasteCategory, setWasteCategory] = useState<LogWasteInput["category"]>("spilled");
  const [walletTopUpOpen, setWalletTopUpOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(false);

  const sortedOrders = [...activeOrders].sort((a, b) => {
    const sp = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
    return sp !== 0 ? sp : b.lastUpdatedAt.localeCompare(a.lastUpdatedAt);
  });

  // Load menu + active bean lot (parallel — no waterfall)
  useEffect(() => {
    getMenu().then(r => {
      if (r.ok) {
        setMenu(r.data);
        const cats = [...new Set(r.data.map(i => i.category))];
        if (cats.length) setActiveCategory(cats[0]);
      }
    }).finally(() => setMenuLoading(false));

    // M9: fetch active bean lot for freshness indicator
    getActiveBeanLot().then(r => {
      if (r.ok) setActiveBeanLot(r.data.lot);
    }).catch(() => { /* non-fatal */ });
  }, []);

  // Customer search debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setSearchResults([]); setSearchOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      const r = await searchCustomer(query);
      if (r.ok) { setSearchResults(r.data); setSearchOpen(true); }
    }, 320);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Fetch full order when expanded
  async function fetchFullOrder(orderId: string) {
    if (fullOrders[orderId]) return;
    try {
      const r = await fetch(`/api/pos/order/${orderId}`);
      if (r.ok) {
        const d = await r.json();
        setFullOrders(prev => ({ ...prev, [orderId]: d.order }));
      } else {
        setActionError(prev => ({ ...prev, [orderId]: "Failed to load order details." }));
      }
    } catch {
      setActionError(prev => ({ ...prev, [orderId]: "Network error — could not load order details." }));
    }
  }

  function toggleExpand(orderId: string) {
    if (expandedId === orderId) {
      setExpandedId(null);
    } else {
      setExpandedId(orderId);
      setShowDiscount(null);
      setDiscountMsg(null);
      setCancelConfirm(null);
      setActionError(prev => ({ ...prev, [orderId]: null }));
    }
  }

  // Load full order details whenever a card is expanded — covers both manual
  // taps (toggleExpand) and programmatic auto-expand after placing an order.
  // Without this, the auto-expanded new order's action buttons stay disabled
  // (they require `full` to be loaded).
  useEffect(() => {
    if (expandedId) fetchFullOrder(expandedId);
  }, [expandedId]);

  // ── Order building ─────────────────────────────────────────────────────────
  const grouped = menu.reduce<Record<string, MenuItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  async function handlePlaceOrder() {
    if (items.length === 0 || submitting) return;
    setSubmitting(true);
    setOrderError(null);

    // Offline path (M19) — show the deferred-payment notice; the barista takes
    // payment in person and confirms, which writes to the outbox.
    if (!navigator.onLine) {
      setSubmitting(false);
      setOfflineDeferred(true);
      setShowPayment(true);
      return;
    }
    const r = await createOrder({
      customerId: customer?.id,
      items: items.map(i => ({ menuItemId: i.menuItemId, quantity: i.quantity, modifications: i.modifications.map(m => m.id) })),
    }).catch(() => ({ ok: false as const, code: "ERR", message: "Failed to place order." }));
    setSubmitting(false);
    if (r.ok) {
      // Auto-expand the new order in the queue so barista sees it immediately
      setExpandedId(r.data.orderId);
      setYocoSecret(r.data.yocoClientSecret);
      setPaymentOrderId(r.data.orderId);
      setRedeemed(false);
      if (r.data.yocoClientSecret) {
        setShowPayment(true);
      } else {
        // No Yoco key (dev mode / offline) — order is in the DB, inform barista.
        setOrderSuccess("Order placed — accept cash or card manually.");
        reset();
        setTimeout(() => setOrderSuccess(null), 4000);
      }
    } else {
      setOrderError(r.message);
    }
  }

  // M19 — confirm the offline order: write to the outbox with a deferred charge.
  async function confirmDeferredQueue() {
    if (queueing) return;
    setQueueing(true);
    try {
      await queueOrder({
        clientUuid: crypto.randomUUID(),
        staffId,
        customerId: customer?.id,
        items: items.map(i => ({
          menuItemId: i.menuItemId,
          quantity: i.quantity,
          modifications: i.modifications.map(m => m.id),
        })),
        paymentMode: "yoco_deferred",
        clientTotalZar: totalZar,
        clientTimestamp: new Date().toISOString(),
      });
      reset();
      setShowPayment(false);
      setOfflineDeferred(false);
      setOrderSuccess("Order queued — charge reconciles when back online.");
      setTimeout(() => setOrderSuccess(null), 5000);
    } catch {
      setOrderError("Failed to save order offline. Please retry.");
    } finally {
      setQueueing(false);
    }
  }

  // ── Queue actions ──────────────────────────────────────────────────────────
  async function handleAdvance(orderId: string, order: Order) {
    const next = STATE_NEXT[order.state];
    if (!next) return;
    setAdvancing(prev => ({ ...prev, [orderId]: true }));
    setActionError(prev => ({ ...prev, [orderId]: null }));
    const r = await transitionOrder(orderId, next).catch(() => ({ ok: false as const, code: "ERR", message: "Action failed." }));
    setAdvancing(prev => ({ ...prev, [orderId]: false }));
    if (r.ok) {
      setFullOrders(prev => ({ ...prev, [orderId]: r.data }));
      if (r.data.state === "collected") {
        setTimeout(() => {
          setExpandedId(null);
          setFullOrders(prev => { const n = { ...prev }; delete n[orderId]; return n; });
        }, 1000);
      }
    } else {
      setActionError(prev => ({ ...prev, [orderId]: r.message }));
    }
  }

  /** Open the waste dialog with a given default category (M13 remake flow). */
  function openWaste(category: LogWasteInput["category"]) {
    setWasteCategory(category);
    setWasteOpen(true);
  }

  async function handleCancel(orderId: string) {
    setCancelConfirm(null);
    setAdvancing(prev => ({ ...prev, [orderId]: true }));
    const r = await cancelOrder(orderId, "Cancelled at POS").catch(() => ({ ok: false as const, code: "ERR", message: "Could not cancel." }));
    setAdvancing(prev => ({ ...prev, [orderId]: false }));
    if (r.ok) {
      setExpandedId(null);
      setFullOrders(prev => { const n = { ...prev }; delete n[orderId]; return n; });
      // M13: cancel + waste are independent. Offer a waste shortcut without
      // blocking — a partial failure on either side never affects the other.
      toast.success("Order cancelled", {
        description: "Wasting the made drink?",
        action: { label: "Report waste", onClick: () => openWaste("overproduction") },
      });
    } else {
      setActionError(prev => ({ ...prev, [orderId]: r.message }));
      toast.error(r.message ?? "Could not cancel.");
    }
  }

  async function handleApplyDiscount(orderId: string, order: Order) {
    if (!discountId.trim()) { setDiscountMsg("Enter staff ID."); return; }
    setDiscountMsg(null);
    const r = await applyStaffDiscount(orderId, discountId.trim()).catch(() => ({ ok: false as const, code: "ERR", message: "Could not apply." }));
    if (r.ok) {
      setDiscountMsg("✓ Free coffee applied.");
      setFullOrders(prev => ({ ...prev, [orderId]: { ...order, totalZar: 0, isStaffDiscount: true } }));
      setShowDiscount(null);
    } else {
      setDiscountMsg(r.message);
    }
  }

  async function handleSignOut() {
    await signOut();
    router.push("/pos");
  }

  // Quick Keys — top 5 most-ordered items pinned for fast access
  const quickKeys = menu.length > 0 ? [
    ...menu.filter(i => i.category === "coffee").slice(0, 3),
    ...menu.filter(i => i.category === "food").slice(0, 1),
    ...menu.filter(i => i.category === "cold_brew").slice(0, 1),
  ].slice(0, 5) : [];

  return (
    <main className="flex flex-col h-screen overflow-hidden">

      {/* ════════ OFFLINE BANNER (M19) ════════ */}
      <OfflineBanner pendingCount={pendingCount} />

      {/* ════════ OUT-OF-STOCK BANNER (M9) ════════ */}
      <StockBanner outOfStockItems={outOfStockItems} />

      <div className="flex flex-1 overflow-hidden">

      {/* ════════ LEFT — ORDER BUILDER ════════ */}
      <div className="flex flex-col border-r border-cool-steel/20" style={{ width: "60%" }}>

        {/* Top header: logo + customer search + staff + logout */}
        <div className="flex items-center gap-3 px-3 py-2 border-b border-cool-steel/20 shrink-0">
          <Image src="/brand/logos/logo-monogram.svg" alt="FAVO" width={24} height={24} className="opacity-80 shrink-0" />
          {/* Customer search — inline in header */}
          <div className="flex-1 relative">
            <Search size={13} strokeWidth={2} className="absolute left-2 top-1/2 -translate-y-1/2 text-cool-steel pointer-events-none" />
            <input type="search" inputMode="text" autoComplete="off"
              placeholder="Customer name or phone (optional)…"
              value={query}
              onChange={e => { setQuery(e.target.value); if (!e.target.value) setCustomer(null); }}
              onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              className="w-full rounded-[4px] border border-cool-steel/20 bg-coffee-bean/5 pl-7 pr-7 py-1.5 text-coffee-bean placeholder:text-cool-steel text-xs focus:border-crimson-carrot focus:outline-none min-h-[34px]"
            />
            {customer && (
              <button type="button" onClick={() => { setCustomer(null); setQuery(""); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-cool-steel hover:text-coffee-bean">
                <X size={12} strokeWidth={2} />
              </button>
            )}
            {searchOpen && searchResults.length > 0 && !customer && (
              <ul className="absolute z-50 left-0 right-0 top-full mt-1 rounded-[2px] border border-cool-steel/20 bg-surface shadow-[var(--shadow-2)] overflow-hidden">
                {searchResults.map(c => (
                  <li key={c.id}>
                    <button type="button" onMouseDown={() => { setCustomer(c); setQuery(""); setSearchOpen(false); }}
                      className="flex w-full items-center justify-between px-3 py-2 min-h-[36px] hover:bg-coffee-bean/8 text-left">
                      <span className="favo-small text-coffee-bean font-semibold">{c.name}</span>
                      {c.loyaltyPoints > 0 && <span className="favo-caption text-crimson-carrot">{c.loyaltyPoints} pts</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {customer && (
            <span className="favo-caption text-crimson-carrot shrink-0 flex items-center gap-1">
              <Star size={10} strokeWidth={2} />{customer.name}
            </span>
          )}
          {customer && (
            <button type="button" onClick={() => setWalletTopUpOpen(true)}
              className="shrink-0 flex items-center gap-1 rounded-[var(--radius-btn)] border border-cool-steel/30 px-2 py-1 favo-caption text-cool-steel hover:bg-porcelain/10 hover:text-porcelain min-h-[32px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
              aria-label="Top up wallet">
              <Wallet size={12} strokeWidth={2.25} /> Top up
            </button>
          )}
          {customer && (
            <button type="button" onClick={() => setPackOpen(true)}
              className="shrink-0 flex items-center gap-1 rounded-[var(--radius-btn)] border border-cool-steel/30 px-2 py-1 favo-caption text-cool-steel hover:bg-porcelain/10 hover:text-porcelain min-h-[32px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
              aria-label="Buy coffee pack">
              <Package size={12} strokeWidth={2.25} /> Pack
            </button>
          )}
          <div className="shrink-0 hidden lg:block"><ActiveBeanCard /></div>
          <span className="favo-small text-cool-steel shrink-0 hidden lg:block">{staffName}</span>
          {/* M15 — connectivity pill; tap opens the sync drawer */}
          <ConnectivityPill
            pendingCount={pendingCount}
            syncing={syncing}
            onClick={() => { refresh(); setSyncDrawerOpen(true); }}
          />
        </div>

        {!showPayment ? (
          <>
          {/* M9 — Bean freshness alert banner */}
          {activeBeanLot?.roastDate && (() => {
            const f = freshness(activeBeanLot.roastDate!);
            if (f === "fresh") return null;
            const days = daysSinceRoast(activeBeanLot.roastDate!);
            const isStale = f === "stale";
            return (
              <div
                className="shrink-0 flex items-center gap-2 px-3 py-1.5 favo-caption"
                style={{
                  background: isStale
                    ? "color-mix(in srgb, var(--color-error, #dc2626) 12%, transparent)"
                    : "color-mix(in srgb, var(--color-warning, #eab308) 12%, transparent)",
                  color: isStale ? "var(--color-error, #dc2626)" : "var(--color-warning, #eab308)",
                  borderBottom: "1px solid currentColor",
                  opacity: 0.9,
                }}
                role="alert"
              >
                <span aria-hidden>{isStale ? "●" : "▲"}</span>
                <span>
                  Beans {isStale ? "past peak" : "ageing"} ({days}d since roast)
                  {activeBeanLot.sourceName ? ` — ${activeBeanLot.sourceName}` : ""}
                </span>
              </div>
            );
          })()}
          <div className="flex flex-1 overflow-hidden">

            {/* ── Vertical category sidebar ── */}
            <div className="flex flex-col border-r border-cool-steel/15 shrink-0 pt-2" style={{ width: "13%" }}>
              {Object.keys(grouped).map(cat => {
                const active = activeCategory === cat;
                return (
                  <button key={cat} type="button" onClick={() => setActiveCategory(cat)}
                    className="text-left py-3 px-2 transition-colors min-h-[44px]"
                    style={{
                      fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13,
                      letterSpacing: "0.06em", textTransform: "uppercase",
                      color: active ? "var(--color-crimson-carrot)" : "var(--color-cool-steel)",
                      borderLeft: active ? "3px solid var(--color-crimson-carrot)" : "3px solid transparent",
                      background: active ? "rgba(245,86,12,0.08)" : "none",
                    }}>
                    {CATEGORY_LABEL[cat] ?? cat}
                  </button>
                );
              })}
            </div>

            {/* ── Menu area: Quick Keys + grid ── */}
            <div className="flex flex-col flex-1 overflow-hidden">

              {/* Quick Keys row */}
              {quickKeys.length > 0 && (
                <div className="shrink-0 border-b border-cool-steel/15 px-3 pt-2 pb-2">
                  <p className="favo-label mb-1.5">Quick Keys</p>
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${quickKeys.length}, 1fr)` }}>
                    {quickKeys.map(item => {
                      const stock = menuItemStock(item.id);
                      const oos = stock === "out";
                      return (
                        <button key={`qk-${item.id}`} type="button"
                          disabled={oos}
                          onClick={() => { if (!oos) { setModTarget(item); setSelectedMods([]); } }}
                          className="relative flex flex-col items-start rounded-[2px] p-2 min-h-[52px] text-left transition-all active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot disabled:cursor-not-allowed"
                          style={{ background: "rgba(245,86,12,0.1)", border: "1px solid rgba(245,86,12,0.25)", opacity: oos ? 0.4 : 1 }}>
                          <span className="text-coffee-bean font-semibold leading-tight" style={{ fontSize: 12 }}>{item.name}</span>
                          <span className="text-coffee-bean/70 mt-auto" style={{ fontSize: 11 }}>{formatZar(item.currentPriceZar)}</span>
                          {stock !== "ok" && (
                            <span className="absolute top-1 right-1"><StockBadge state={stock} /></span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Menu grid */}
              <div className="flex-1 overflow-y-auto px-3 pt-2 pb-2">
                {menuLoading ? (
                  <div className="flex items-center justify-center h-32 text-cool-steel gap-2">
                    <Loader2 size={18} strokeWidth={2} className="animate-spin" />
                    <span className="favo-small">Loading…</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {(grouped[activeCategory] ?? []).map(item => {
                      const stock = menuItemStock(item.id);
                      const oos = stock === "out";
                      return (
                        <button key={item.id} type="button"
                          disabled={oos}
                          onClick={() => { if (!oos) { setModTarget(item); setSelectedMods([]); } }}
                          className="relative flex flex-col items-start rounded-[2px] border border-cool-steel/20 bg-porcelain/5 p-3 min-h-[72px] text-left transition-all hover:bg-porcelain/10 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-porcelain/5">
                          <span className="favo-small text-coffee-bean font-semibold leading-tight">{item.name}</span>
                          <span className="favo-caption text-coffee-bean/70 mt-auto pt-1">{formatZar(item.currentPriceZar)}</span>
                          {stock !== "ok" && (
                            <span className="absolute top-1.5 right-1.5"><StockBadge state={stock} /></span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

            {/* Order placed success banner — outside items gate so it shows after reset() */}
          {orderSuccess && (
            <div className="border-t border-cool-steel/20 px-4 py-3 shrink-0">
              <p className="favo-small rounded px-3 py-2" role="status" aria-live="polite"
                style={{ background: "color-mix(in srgb, var(--color-success) 15%, transparent)", color: "var(--color-success)" }}>
                ✓ {orderSuccess}
              </p>
            </div>
          )}

          {/* Order summary */}
            {items.length > 0 && (
              <div className="border-t border-cool-steel/20 px-4 py-3 shrink-0 bg-coffee-bean/5">
                {/* M18 — loyalty standing for the attached customer */}
                {customer && (
                  <div className="mb-2">
                    <CustomerCard customer={customer} onClear={() => setCustomer(null)} />
                  </div>
                )}
                <p className="favo-label text-cool-steel mb-2">Order</p>
                <div className="space-y-1.5 max-h-[160px] overflow-y-auto mb-3">
                  {items.map(item => (
                    <div key={lineKey(item)} className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => updateQuantity(lineKey(item), item.quantity - 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-[2px] border border-cool-steel/30 text-cool-steel hover:bg-coffee-bean/8">
                          <Minus size={12} strokeWidth={2} />
                        </button>
                        <span className="favo-small text-coffee-bean w-5 text-center">{item.quantity}</span>
                        <button type="button" onClick={() => updateQuantity(lineKey(item), item.quantity + 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-[2px] border border-cool-steel/30 text-cool-steel hover:bg-coffee-bean/8">
                          <Plus size={12} strokeWidth={2} />
                        </button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="favo-small text-coffee-bean truncate">{item.menuItemName}</p>
                        {item.modifications.length > 0 && (
                          <p className="favo-caption text-cool-steel truncate">{item.modifications.map(m => m.name).join(", ")}</p>
                        )}
                      </div>
                      <span className="favo-small text-coffee-bean shrink-0">
                        {formatZar((item.unitPriceZar + item.modifications.reduce((s, m) => s + m.priceDeltaZar, 0)) * item.quantity)}
                      </span>
                      <button type="button" onClick={() => removeItem(lineKey(item))}
                        className="flex h-7 w-7 items-center justify-center text-cool-steel hover:text-[var(--color-error)]">
                        <Trash2 size={12} strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
                {orderError && <p className="favo-small text-[var(--color-error)] mb-2" role="alert">{orderError}</p>}
                {orderSuccess && (
                  <p className="favo-small mb-2 rounded px-3 py-2" role="status"
                    style={{ background: "color-mix(in srgb, var(--color-success) 15%, transparent)", color: "var(--color-success)" }}>
                    ✓ {orderSuccess}
                  </p>
                )}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="favo-label text-cool-steel">Total</p>
                    <p className="favo-subhead text-coffee-bean">{formatZar(totalZar)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowWasteModal(true)}
                      className="favo-caption text-cool-steel/60 hover:text-cool-steel flex items-center gap-1 px-2 min-h-[44px] rounded-[4px] hover:bg-coffee-bean/5 transition-colors"
                      aria-label="Log waste"
                    >
                      <Trash2 size={12} strokeWidth={2} aria-hidden />
                      <span>Waste</span>
                    </button>
                    <button type="button" onClick={() => reset()}
                      className="rounded-[4px] border border-cool-steel/30 px-3 py-2 favo-small text-cool-steel hover:bg-coffee-bean/8 min-h-[44px]">
                      Clear
                    </button>
                    <button type="button" onClick={handlePlaceOrder} disabled={submitting}
                      className="flex items-center gap-2 rounded-[4px] px-4 py-2 min-h-[44px] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
                      style={{ background: "var(--color-crimson-carrot)", color: "var(--color-porcelain)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}>
                      {submitting
                        ? <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                        : "Place Order"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : offlineDeferred ? (
          /* M19 — offline deferred payment: take payment in person, queue order */
          <DeferredPaymentNotice
            totalZar={totalZar}
            queueing={queueing}
            onConfirm={confirmDeferredQueue}
            onCancel={() => { setShowPayment(false); setOfflineDeferred(false); }}
          />
        ) : (
          /* Payment confirmation */
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
            <ShieldCheck size={40} strokeWidth={1.5} className="text-cool-steel opacity-60" />
            <div className="text-center">
              <p className="favo-label text-cool-steel mb-1">Amount due</p>
              <p className="favo-h2 text-coffee-bean">{formatZar(redeemed ? 0 : totalZar)}</p>
              <p className="favo-small text-cool-steel mt-1">
                {redeemed ? "Paid with 100 loyalty points" : "Card handled securely by Yoco"}
              </p>
            </div>
            <div className="flex flex-col gap-3 w-full max-w-[280px]">
              {/* M18 — full loyalty redemption (L06): 100 pts → R20 off, zeroes the order.
                  Offered only at ≥100 pts and when the order is worth ≥ R20. */}
              {customer && customer.loyaltyPoints >= 100 && totalZar >= 2000 && !redeemed && paymentOrderId && (
                <button type="button" onClick={() => setRedeemOpen(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-[4px] border border-crimson-carrot/50 py-3 min-h-[48px] favo-small text-crimson-carrot hover:bg-crimson-carrot/8 transition-colors">
                  <Star size={14} strokeWidth={2.25} />
                  Redeem 100 pts (R20 off)
                </button>
              )}
              <button type="button" onClick={() => { reset(); setShowPayment(false); setYocoSecret(""); setPaymentOrderId(null); setRedeemed(false); }}
                className="flex w-full items-center justify-center gap-2 rounded-[4px] py-4 min-h-[52px]"
                style={{ background: "var(--color-success)", color: "var(--color-porcelain)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}>
                <CheckCircle size={16} strokeWidth={2} className="mr-1" />
                Confirm Paid
              </button>
              <button type="button" onClick={() => setShowPayment(false)}
                className="favo-small text-cool-steel underline underline-offset-2 hover:text-coffee-bean transition-colors">
                ← Back to order
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ════════ RIGHT — LIVE QUEUE ════════ */}
      <div className="flex flex-col" style={{ width: "40%" }}>

        {/* Queue header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-cool-steel/20 shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="favo-h3 text-coffee-bean">Queue</h2>
            <StreamChip status={status} />
          </div>
          <button type="button" onClick={handleSignOut} aria-label="Sign out"
            className="flex h-9 w-9 items-center justify-center rounded-[4px] text-cool-steel hover:bg-coffee-bean/8 hover:text-coffee-bean transition-colors">
            <LogOut size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Order cards — accordion */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {sortedOrders.length === 0 && status === "connected" && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-cool-steel">
              <Coffee size={40} strokeWidth={1.5} className="opacity-30" />
              <p className="favo-small opacity-60">Queue is clear</p>
            </div>
          )}
          {sortedOrders.length === 0 && status !== "connected" && (
            <div className="flex items-center justify-center gap-2 py-16 text-cool-steel">
              <RefreshCw size={16} strokeWidth={2} className="animate-spin opacity-60" />
              <span className="favo-small opacity-60">Connecting…</span>
            </div>
          )}

          {sortedOrders.map(o => {
            const isExpanded = expandedId === o.orderId;
            const full = fullOrders[o.orderId];
            const busy = advancing[o.orderId];
            const err = actionError[o.orderId];
            const nextState = STATE_NEXT[o.state];
            const isDone = o.state === "collected" || o.state === "cancelled";
            const isReady = o.state === "ready";

            return (
              <div key={o.orderId}
                className={["rounded-[2px] border overflow-hidden transition-all", STATE_CARD[o.state]].join(" ")}>

                {/* Card header — always visible, tap to expand */}
                <button type="button" onClick={() => toggleExpand(o.orderId)}
                  className="w-full flex items-center justify-between px-3 py-3 min-h-[60px] hover:bg-coffee-bean/5 transition-colors text-left">
                  <div className="flex items-center gap-2">
                    <span className={["block h-2 w-2 rounded-full shrink-0", STATE_DOT[o.state]].join(" ")} />
                    <div>
                      <p className="favo-small text-coffee-bean font-semibold leading-tight">
                        #{o.orderId.slice(-6).toUpperCase()}
                      </p>
                      <p className="favo-caption text-cool-steel">{formatDate(new Date(o.lastUpdatedAt))}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={["favo-caption rounded-[999px] px-2 py-0.5", STATE_BADGE[o.state]].join(" ")}>
                      {STATE_LABEL[o.state]}
                    </span>
                    {isExpanded
                      ? <ChevronUp size={14} strokeWidth={2} className="text-cool-steel shrink-0" />
                      : <ChevronDown size={14} strokeWidth={2} className="text-cool-steel shrink-0" />
                    }
                  </div>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-cool-steel/10 px-3 pb-3 pt-2 space-y-2 bg-coffee-bean/3">

                    {/* Order items */}
                    {!full ? (
                      <div className="flex items-center gap-2 py-2 text-cool-steel">
                        <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                        <span className="favo-small">Loading items…</span>
                      </div>
                    ) : (
                      <>
                        {full.customerName && (
                          <p className="favo-caption text-cool-steel">
                            Customer: <span className="text-coffee-bean">{full.customerName}</span>
                          </p>
                        )}
                        <div className="space-y-1">
                          {full.items.map(item => (
                            <div key={item.id} className="flex justify-between items-start">
                              <div>
                                <p className="favo-small text-coffee-bean">
                                  {item.quantity > 1 && <span className="text-crimson-carrot mr-1">{item.quantity}×</span>}
                                  {item.menuItemName || `Item #${item.id.slice(-4)}`}
                                </p>
                                {item.modifications.length > 0 && (
                                  <p className="favo-caption text-cool-steel">{item.modifications.map(m => m.name).join(", ")}</p>
                                )}
                              </div>
                              <span className="favo-small text-coffee-bean shrink-0 ml-3">
                                {formatZar((item.unitPriceZar + item.modifications.reduce((s, m) => s + m.priceDeltaZar, 0)) * item.quantity)}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between border-t border-cool-steel/10 pt-1.5">
                          <span className="favo-caption text-cool-steel">TOTAL</span>
                          <span className={["favo-small font-semibold", full.isStaffDiscount ? "text-[var(--color-success)]" : "text-coffee-bean"].join(" ")}>
                            {full.isStaffDiscount ? "FREE (staff)" : formatZar(full.totalZar)}
                          </span>
                        </div>
                      </>
                    )}

                    {/* Error */}
                    {err && (
                      <div className="flex items-center gap-1.5 text-[var(--color-error)]">
                        <AlertCircle size={12} strokeWidth={2} />
                        <span className="favo-caption">{err}</span>
                      </div>
                    )}

                    {/* Staff discount */}
                    {full && !isDone && !full.isStaffDiscount && (
                      <div>
                        {showDiscount !== o.orderId ? (
                          <button type="button"
                            onClick={() => {
                              setShowDiscount(o.orderId);
                              setDiscountMsg(null);
                              // Pre-fill with the logged-in barista's own ID (L03: most discounts are self-applied)
                              setDiscountId(staffId);
                            }}
                            className="flex items-center gap-1 favo-caption text-cool-steel hover:text-coffee-bean min-h-[32px] transition-colors">
                            <Tag size={11} strokeWidth={2} /> Apply staff discount
                          </button>
                        ) : (
                          <div className="space-y-1.5 rounded-[2px] border border-cool-steel/20 bg-coffee-bean/5 p-2">
                            <p className="favo-caption text-cool-steel">
                              Staff member: <span className="text-coffee-bean">{staffName}</span>
                            </p>
                            <input type="text" value={discountId} onChange={e => setDiscountId(e.target.value)}
                              placeholder="Override with different staff ID"
                              className="w-full rounded-[2px] border border-cool-steel/30 bg-coffee-bean/8 px-2 py-1 text-coffee-bean favo-caption min-h-[32px] focus:border-crimson-carrot focus:outline-none" />
                            {discountMsg && (
                              <p className={["favo-caption", discountMsg.startsWith("✓") ? "text-[var(--color-success)]" : "text-[var(--color-error)]"].join(" ")}>
                                {discountMsg}
                              </p>
                            )}
                            <div className="flex gap-1.5">
                              <button type="button" onClick={() => full && handleApplyDiscount(o.orderId, full)}
                                className="flex-1 rounded-[2px] py-1 favo-caption min-h-[32px]"
                                style={{ background: "var(--color-crimson-carrot)", color: "var(--color-porcelain)", fontWeight: 700 }}>
                                Apply
                              </button>
                              <button type="button" onClick={() => setShowDiscount(null)}
                                className="rounded-[2px] border border-cool-steel/30 px-2 text-cool-steel hover:bg-coffee-bean/8 min-h-[32px]">
                                <X size={11} strokeWidth={2} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Cancel */}
                    {o.state === "ordered" && cancelConfirm !== o.orderId && (
                      <button type="button" onClick={() => setCancelConfirm(o.orderId)}
                        className="favo-caption text-cool-steel hover:text-[var(--color-error)] underline underline-offset-2 min-h-[28px] transition-colors">
                        Cancel order
                      </button>
                    )}
                    {o.state === "ordered" && cancelConfirm === o.orderId && (
                      <div className="flex items-center gap-2">
                        <span className="favo-caption text-[var(--color-error)]">Cancel?</span>
                        <button type="button" onClick={() => handleCancel(o.orderId)}
                          className="favo-caption rounded-[2px] border border-[var(--color-error)]/50 px-2 py-0.5 min-h-[28px] text-[var(--color-error)] hover:bg-[var(--color-error)]/10">
                          Yes
                        </button>
                        <button type="button" onClick={() => setCancelConfirm(null)}
                          className="favo-caption text-cool-steel hover:text-coffee-bean min-h-[28px] px-1 transition-colors">
                          Keep
                        </button>
                      </div>
                    )}


                    {/* Collected success */}
                    {full && o.state === "collected" && (
                      <div className="flex items-center gap-2 py-1">
                        <CheckCircle size={14} strokeWidth={2} className="text-[var(--color-success)]" />
                        <span className="favo-small text-coffee-bean">Collected ✓</span>
                      </div>
                    )}

                    {/* ── TRANSITION BUTTON — the main action ── */}
                    {!isDone && nextState && (
                      <button type="button" onClick={() => full && handleAdvance(o.orderId, full)}
                        disabled={busy || !full}
                        className={["w-full flex items-center justify-center gap-2 rounded-[2px] transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed",
                          isReady ? "min-h-[52px]" : "min-h-[44px]"
                        ].join(" ")}
                        style={{
                          background: isReady ? "var(--color-success)" : "var(--color-crimson-carrot)",
                          color: "var(--color-porcelain)",
                          fontFamily: "var(--font-sans)",
                          fontWeight: 700,
                          fontSize: isReady ? "var(--text-sub)" : "var(--text-small)",
                          letterSpacing: isReady ? "0.04em" : "var(--tracking-cta)",
                          textTransform: "uppercase",
                        }}>
                        {busy
                          ? <Loader2 size={16} strokeWidth={2} className="animate-spin" />
                          : isReady
                          ? <><CheckCircle size={18} strokeWidth={2} />DONE — Collected</>
                          : ADVANCE_LABEL[o.state]
                        }
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      </div>{/* end flex flex-1 row */}

      {/* ════════ WASTE LOG MODAL (M8) ════════ */}
      {showWasteModal && (
        <WasteLogModal
          onClose={() => setShowWasteModal(false)}
          onLogged={() => setShowWasteModal(false)}
        />
      )}

      {/* ════════ MOD SHEET ════════ */}
      {modTarget && (
        <div className="fixed inset-0 z-50 flex items-end bg-coffee-bean/60"
          onClick={e => e.target === e.currentTarget && setModTarget(null)}>
          <div className="w-full max-w-[560px] mx-auto rounded-t-[2px] border-t border-cool-steel/20 bg-surface p-5">
            <p className="favo-h3 text-coffee-bean mb-1">{modTarget.name}</p>
            <p className="favo-small text-cool-steel mb-3">{formatZar(modTarget.currentPriceZar)} — add-ons</p>
            {modTarget.customisations.length === 0
              ? <p className="favo-small text-cool-steel mb-4">No customisations.</p>
              : (
                <ul className="grid grid-cols-2 gap-2 mb-4">
                  {modTarget.customisations.map(mod => {
                    const on = selectedMods.some(m => m.id === mod.id);
                    return (
                      <li key={mod.id}>
                        <button type="button" onClick={() => setSelectedMods(prev =>
                          prev.some(m => m.id === mod.id) ? prev.filter(m => m.id !== mod.id) : [...prev, mod]
                        )} aria-pressed={on}
                          className={["flex w-full items-center justify-between rounded-[2px] border px-3 py-2 min-h-[44px] transition-colors",
                            on ? "border-crimson-carrot bg-crimson-carrot/10 text-coffee-bean" : "border-cool-steel/30 bg-coffee-bean/5 text-coffee-bean hover:bg-coffee-bean/8"
                          ].join(" ")}>
                          <span className="favo-small font-semibold">{mod.name}</span>
                          {mod.priceDeltaZar !== 0 && <span className="favo-caption text-cool-steel">+{formatZar(mod.priceDeltaZar)}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            }
            <button type="button"
              onClick={() => {
                addItem({ menuItemId: modTarget.id, menuItemName: modTarget.name, unitPriceZar: modTarget.currentPriceZar, modifications: selectedMods });
                setModTarget(null);
              }}
              className="flex w-full items-center justify-center rounded-[4px] py-3 min-h-[48px]"
              style={{ background: "var(--color-crimson-carrot)", color: "var(--color-porcelain)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}>
              Add to order
            </button>
          </div>
        </div>
      )}

      {/* ════════ WASTE DIALOG (M13 — cancel→waste shortcut) ════════ */}
      {wasteOpen && (
        <WasteDialog
          defaultCategory={wasteCategory}
          onClose={() => { setWasteOpen(false); setWasteCategory("spilled"); }}
        />
      )}

      {/* ════════ STAFF PUSH OPT-IN (M10) ════════ */}
      <StaffPushOptIn />

      {/* ════════ WALLET TOP-UP (M16) ════════ */}
      {walletTopUpOpen && customer && (
        <WalletTopUpDialog
          customerId={customer.id}
          customerName={customer.name}
          onClose={() => setWalletTopUpOpen(false)}
        />
      )}

      {/* ════════ COFFEE PACK PURCHASE (M17) ════════ */}
      {packOpen && customer && (
        <PackPurchaseDialog
          customerId={customer.id}
          customerName={customer.name}
          coffeeItems={menu.filter((m) => m.category === "coffee")}
          onClose={() => setPackOpen(false)}
        />
      )}

      {/* ════════ LOYALTY REDEMPTION (M18) ════════ */}
      {redeemOpen && customer && paymentOrderId && (
        <LoyaltyRedeemDialog
          customerId={customer.id}
          customerName={customer.name}
          orderId={paymentOrderId}
          loyaltyPoints={customer.loyaltyPoints}
          onRedeemed={() => {
            setRedeemed(true);
            setCustomer({ ...customer, loyaltyPoints: customer.loyaltyPoints - 100 });
          }}
          onClose={() => setRedeemOpen(false)}
        />
      )}

      {/* ════════ OFFLINE SYNC DRAWER (M15) ════════ */}
      <SyncDrawer
        open={syncDrawerOpen}
        orders={pendingOrders}
        syncing={syncing}
        onSyncAll={sync}
        onRetry={syncOne}
        onClose={() => setSyncDrawerOpen(false)}
      />
    </main>
  );
}

function StreamChip({ status }: { status: string }) {
  if (status === "connected") return (
    <span role="status" aria-label="Queue connected" className="flex items-center gap-1 rounded-[999px] bg-[var(--color-success)]/10 px-2 py-0.5">
      <Wifi size={10} strokeWidth={2.5} className="text-[var(--color-success)]" />
      <span className="favo-caption text-[var(--color-success)]">Live</span>
    </span>
  );
  if (status === "offline") return (
    <span role="status" aria-label="Queue offline" className="flex items-center gap-1 rounded-[999px] bg-[var(--color-error)]/10 px-2 py-0.5">
      <WifiOff size={10} strokeWidth={2.5} className="text-[var(--color-error)]" />
      <span className="favo-caption text-[var(--color-error)]">Offline</span>
    </span>
  );
  return (
    <span role="status" aria-label="Queue reconnecting" className="flex items-center gap-1 rounded-[999px] bg-coffee-bean/8 px-2 py-0.5">
      <RefreshCw size={10} strokeWidth={2.5} className="text-cool-steel animate-spin" />
      <span className="favo-caption text-cool-steel">Reconnecting</span>
    </span>
  );
}
