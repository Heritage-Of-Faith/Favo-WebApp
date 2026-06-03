"use client";

// Single-screen POS workspace — owner: Mine
// Left panel: build order (customer search + menu + summary + payment)
// Right panel: live queue (order cards + inline active order actions)
// No page navigation needed — everything lives here.

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { signOut } from "@/server/actions/auth";
import { searchCustomer } from "@/server/actions/customers";
import { getMenu } from "@/server/actions/menu";
import { createOrder, transitionOrder, cancelOrder, applyStaffDiscount } from "@/server/actions/orders";
import { useOrderStream } from "@/hooks/useOrderStream";
import { useDraftOrder } from "@/store/draftOrder";
import { formatZar, formatDate } from "@/lib/format";
import {
  Search, X, Plus, Minus, Trash2, ChevronRight, Loader2,
  Wifi, WifiOff, RefreshCw, Coffee, LogOut, ArrowLeft,
  CheckCircle, AlertCircle, Tag, Star, Delete, ShieldCheck
} from "lucide-react";
import type { Customer, MenuItem, MenuCustomisation, Order, OrderState } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────
type LeftPanel = "menu" | "payment";
type RightView = { kind: "list" } | { kind: "order"; orderId: string; order: Order | null };

const STATE_LABEL: Record<OrderState, string> = {
  ordered: "Waiting", in_progress: "Making", ready: "Ready ✓", collected: "Collected", cancelled: "Cancelled",
};
const STATE_BADGE: Record<OrderState, string> = {
  ordered: "bg-porcelain/10 text-cool-steel",
  in_progress: "bg-[var(--color-warning)]/20 text-[var(--color-warning)]",
  ready: "bg-[var(--color-success)]/20 text-[var(--color-success)]",
  collected: "bg-porcelain/10 text-cool-steel opacity-50",
  cancelled: "bg-[var(--color-error)]/10 text-[var(--color-error)]",
};
const STATE_CARD: Record<OrderState, string> = {
  ordered: "border-cool-steel/20 bg-porcelain/5",
  in_progress: "border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5",
  ready: "border-[var(--color-success)]/50 bg-[var(--color-success)]/10",
  collected: "border-cool-steel/10 bg-transparent opacity-40",
  cancelled: "border-[var(--color-error)]/20 bg-transparent opacity-30",
};
const STATE_DOT: Record<OrderState, string> = {
  ordered: "bg-cool-steel/60",
  in_progress: "bg-[var(--color-warning)] animate-pulse",
  ready: "bg-[var(--color-success)]",
  collected: "bg-cool-steel/30",
  cancelled: "bg-[var(--color-error)]/40",
};
const STATE_NEXT: Partial<Record<OrderState, OrderState>> = {
  ordered: "in_progress", in_progress: "ready", ready: "collected",
};
const ADVANCE_LABEL: Partial<Record<OrderState, string>> = {
  ordered: "Start Making", in_progress: "Mark Ready", ready: "DONE — Collected",
};
const STATE_PRIORITY: Record<OrderState, number> = { ready: 0, in_progress: 1, ordered: 2, collected: 3, cancelled: 4 };

const CATEGORY_LABEL: Record<string, string> = {
  coffee: "Coffee", tea: "Tea", cold_brew: "Cold Brew", food: "Food", merchandise: "Merch", other: "Other",
};

// ─── Props ────────────────────────────────────────────────────────────────────
type Props = { staffName: string; staffId: string };

export default function POSWorkspace({ staffName, staffId }: Props) {
  const router = useRouter();

  // ── Left panel state ──────────────────────────────────────────────────────
  const [leftPanel, setLeftPanel] = useState<LeftPanel>("menu");
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [modTarget, setModTarget] = useState<MenuItem | null>(null);
  const [selectedMods, setSelectedMods] = useState<MenuCustomisation[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [yocoClientSecret, setYocoClientSecret] = useState("");
  const [orderedId, setOrderedId] = useState<string | null>(null);

  // ── Customer search ───────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Customer[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { customer, items, totalZar, setCustomer, addItem, removeItem, updateQuantity, reset } = useDraftOrder();

  // ── Right panel state ─────────────────────────────────────────────────────
  const [rightView, setRightView] = useState<RightView>({ kind: "list" });
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showDiscount, setShowDiscount] = useState(false);
  const [discountId, setDiscountId] = useState("");
  const [discountMsg, setDiscountMsg] = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);

  // ── SSE queue ─────────────────────────────────────────────────────────────
  const { activeOrders, status } = useOrderStream();
  const sortedOrders = [...activeOrders].sort((a, b) => {
    const sp = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
    return sp !== 0 ? sp : b.lastUpdatedAt.localeCompare(a.lastUpdatedAt);
  });

  // Load menu on mount
  useEffect(() => {
    getMenu().then(r => {
      if (r.ok) {
        setMenu(r.data);
        const cats = [...new Set(r.data.map(i => i.category))];
        if (cats.length) setActiveCategory(cats[0]);
      }
    }).finally(() => setMenuLoading(false));
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

  // When right view changes to an order, load it fresh
  useEffect(() => {
    if (rightView.kind === "order" && rightView.orderId) {
      // Load from DB via active order detail approach
      // The order data comes from the queue SSE + local state
    }
  }, [rightView]);

  // Sign out
  async function handleSignOut() {
    await signOut();
    router.push("/pos");
  }

  // ── Order building ────────────────────────────────────────────────────────
  const grouped = menu.reduce<Record<string, MenuItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});
  const categories = Object.keys(grouped);

  function openMods(item: MenuItem) { setModTarget(item); setSelectedMods([]); }
  function toggleMod(mod: MenuCustomisation) {
    setSelectedMods(prev => prev.some(m => m.id === mod.id) ? prev.filter(m => m.id !== mod.id) : [...prev, mod]);
  }
  function confirmAdd() {
    if (!modTarget) return;
    addItem({ menuItemId: modTarget.id, menuItemName: modTarget.name, unitPriceZar: modTarget.currentPriceZar, modifications: selectedMods });
    setModTarget(null);
  }

  async function handlePlaceOrder() {
    if (items.length === 0 || submitting) return;
    setSubmitting(true); setOrderError(null);
    const r = await createOrder({ customerId: customer?.id, items: items.map(i => ({ menuItemId: i.menuItemId, quantity: i.quantity, modifications: i.modifications.map(m => m.id) })) }).catch(() => ({ ok: false as const, code: "ERR", message: "Failed to place order." }));
    setSubmitting(false);
    if (r.ok) {
      setOrderedId(r.data.orderId);
      setYocoClientSecret(r.data.yocoClientSecret);
      if (r.data.yocoClientSecret) {
        setLeftPanel("payment");
      } else {
        // No Yoco key — order created, reset and show success briefly
        reset();
        setLeftPanel("menu");
      }
    } else {
      setOrderError(r.message);
    }
  }

  function handlePaymentSuccess() {
    reset();
    setOrderedId(null);
    setYocoClientSecret("");
    setLeftPanel("menu");
  }

  // ── Active order actions ───────────────────────────────────────────────────
  async function loadOrder(orderId: string) {
    // Fetch the full order from the server
    const r = await fetch(`/api/pos/order/${orderId}`).catch(() => null);
    if (r?.ok) {
      const data = await r.json();
      setActiveOrder(data.order);
    }
  }

  async function handleAdvance(order: Order) {
    const next = STATE_NEXT[order.state];
    if (!next || advancing) return;
    setAdvancing(true); setActionError(null);
    const r = await transitionOrder(order.id, next).catch(() => ({ ok: false as const, code: "ERR", message: "Action failed." }));
    setAdvancing(false);
    if (r.ok) {
      setActiveOrder(r.data);
      if (r.data.state === "collected") {
        setTimeout(() => { setRightView({ kind: "list" }); setActiveOrder(null); }, 800);
      }
    } else { setActionError(r.message); }
  }

  async function handleCancel(order: Order) {
    if (advancing) return;
    setAdvancing(true); setActionError(null);
    const r = await cancelOrder(order.id, "Cancelled at POS").catch(() => ({ ok: false as const, code: "ERR", message: "Could not cancel." }));
    setAdvancing(false);
    if (r.ok) { setRightView({ kind: "list" }); setActiveOrder(null); }
    else setActionError(r.message);
  }

  async function handleApplyDiscount(order: Order) {
    if (!discountId.trim()) { setDiscountMsg("Enter staff ID."); return; }
    setDiscountMsg(null);
    const r = await applyStaffDiscount(order.id, discountId.trim()).catch(() => ({ ok: false as const, code: "ERR", message: "Could not apply." }));
    if (r.ok) {
      setDiscountMsg("✓ Free coffee applied.");
      setActiveOrder(o => o ? { ...o, totalZar: 0, isStaffDiscount: true } : o);
      setShowDiscount(false);
    } else setDiscountMsg(r.message);
  }

  async function openOrder(orderId: string) {
    setActionError(null); setShowDiscount(false); setDiscountMsg(null); setCancelConfirm(false);
    // Find in SSE stream first
    const streamOrder = activeOrders.find(o => o.orderId === orderId);
    setRightView({ kind: "order", orderId, order: null });
    // Load full order details
    await loadOrder(orderId);
  }

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ════ LEFT PANEL — ORDER BUILDER ════ */}
      <div className="flex flex-col border-r border-cool-steel/20" style={{ width: "58%" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-cool-steel/20 shrink-0">
          <Image src="/brand/logos/logo-monogram.svg" alt="FAVO" width={28} height={28} className="opacity-80" />
          <span className="favo-label text-cool-steel">New Order</span>
          <span className="favo-small text-cool-steel">{staffName}</span>
        </div>

        {leftPanel === "menu" && (
          <>
            {/* Customer search */}
            <div className="px-4 pt-3 pb-2 shrink-0 relative">
              <div className="relative flex items-center">
                <Search size={14} strokeWidth={2} className="absolute left-3 text-cool-steel pointer-events-none" />
                <input
                  type="search" inputMode="text" autoComplete="off"
                  placeholder="Search customer by name or phone (optional)…"
                  value={query}
                  onChange={e => { setQuery(e.target.value); if (!e.target.value) setCustomer(null); }}
                  onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
                  onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                  className="w-full rounded-[4px] border border-cool-steel/30 bg-porcelain/10 pl-8 pr-3 py-2 text-porcelain placeholder:text-cool-steel favo-small focus:border-crimson-carrot focus:outline-none min-h-[40px]"
                />
                {customer && (
                  <button type="button" onClick={() => { setCustomer(null); setQuery(""); }}
                    className="absolute right-2 text-cool-steel hover:text-porcelain">
                    <X size={14} strokeWidth={2} />
                  </button>
                )}
              </div>
              {customer && (
                <div className="flex items-center gap-2 mt-1 px-1">
                  <span className="favo-small text-porcelain font-semibold">{customer.name}</span>
                  {customer.loyaltyPoints > 0 && (
                    <span className="flex items-center gap-0.5 favo-caption text-crimson-carrot">
                      <Star size={10} strokeWidth={2} />{customer.loyaltyPoints} pts
                    </span>
                  )}
                </div>
              )}
              {/* Search dropdown */}
              {searchOpen && searchResults.length > 0 && !customer && (
                <ul className="absolute z-50 left-4 right-4 top-full mt-1 rounded-[2px] border border-cool-steel/20 bg-dark-teal shadow-[var(--shadow-2)] overflow-hidden">
                  {searchResults.map(c => (
                    <li key={c.id}>
                      <button type="button" onMouseDown={() => { setCustomer(c); setQuery(""); setSearchOpen(false); }}
                        className="flex w-full items-center justify-between px-3 py-2 min-h-[40px] hover:bg-porcelain/10 text-left">
                        <div>
                          <p className="favo-small text-porcelain font-semibold">{c.name}</p>
                          {c.phone && <p className="favo-caption text-cool-steel">{c.phone}</p>}
                        </div>
                        {c.loyaltyPoints > 0 && <span className="favo-caption text-crimson-carrot">{c.loyaltyPoints} pts</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Category tabs */}
            <div className="flex gap-1 px-4 pb-2 overflow-x-auto shrink-0 scrollbar-none">
              {categories.map(cat => (
                <button key={cat} type="button" onClick={() => setActiveCategory(cat)}
                  className={["favo-caption px-3 py-1 rounded-[999px] transition-colors whitespace-nowrap",
                    activeCategory === cat ? "bg-crimson-carrot text-porcelain" : "bg-porcelain/10 text-cool-steel hover:bg-porcelain/20 hover:text-porcelain"
                  ].join(" ")}
                  style={activeCategory === cat ? { color: "var(--color-porcelain)" } : undefined}>
                  {CATEGORY_LABEL[cat] ?? cat}
                </button>
              ))}
            </div>

            {/* Menu grid */}
            <div className="flex-1 overflow-y-auto px-4 pb-2">
              {menuLoading ? (
                <div className="flex items-center justify-center h-32 text-cool-steel gap-2">
                  <Loader2 size={18} strokeWidth={2} className="animate-spin" />
                  <span className="favo-small">Loading menu…</span>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {(grouped[activeCategory] ?? []).map(item => (
                    <button key={item.id} type="button" onClick={() => openMods(item)}
                      className="flex flex-col items-start rounded-[2px] border border-cool-steel/20 bg-porcelain/5 p-3 min-h-[72px] text-left transition-all hover:bg-porcelain/10 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot">
                      <span className="favo-small text-porcelain font-semibold leading-tight">{item.name}</span>
                      <span className="favo-caption text-cool-steel mt-auto pt-1">{formatZar(item.currentPriceZar)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Order summary */}
            {items.length > 0 && (
              <div className="border-t border-cool-steel/20 px-4 py-3 shrink-0 bg-porcelain/5">
                <p className="favo-label text-cool-steel mb-2">Order</p>
                <div className="space-y-1 max-h-[140px] overflow-y-auto mb-3">
                  {items.map(item => (
                    <div key={item.menuItemId} className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => updateQuantity(item.menuItemId, item.quantity - 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-[2px] border border-cool-steel/30 text-cool-steel hover:bg-porcelain/10">
                          <Minus size={12} strokeWidth={2} />
                        </button>
                        <span className="favo-small text-porcelain w-5 text-center">{item.quantity}</span>
                        <button type="button" onClick={() => updateQuantity(item.menuItemId, item.quantity + 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-[2px] border border-cool-steel/30 text-cool-steel hover:bg-porcelain/10">
                          <Plus size={12} strokeWidth={2} />
                        </button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="favo-small text-porcelain truncate">{item.menuItemName}</p>
                        {item.modifications.length > 0 && <p className="favo-caption text-cool-steel truncate">{item.modifications.map(m => m.name).join(", ")}</p>}
                      </div>
                      <span className="favo-small text-porcelain shrink-0">
                        {formatZar((item.unitPriceZar + item.modifications.reduce((s, m) => s + m.priceDeltaZar, 0)) * item.quantity)}
                      </span>
                      <button type="button" onClick={() => removeItem(item.menuItemId)}
                        className="text-cool-steel hover:text-[var(--color-error)] h-7 w-7 flex items-center justify-center">
                        <Trash2 size={12} strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
                {orderError && <p className="favo-small text-[var(--color-error)] mb-2" role="alert">{orderError}</p>}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="favo-label text-cool-steel">Total</p>
                    <p className="favo-subhead text-porcelain">{formatZar(totalZar)}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => reset()}
                      className="rounded-[4px] border border-cool-steel/30 px-3 py-2 favo-small text-cool-steel hover:bg-porcelain/10 min-h-[40px]">
                      Clear
                    </button>
                    <button type="button" onClick={handlePlaceOrder} disabled={submitting}
                      className="flex items-center gap-2 rounded-[4px] bg-crimson-carrot px-4 py-2 min-h-[40px] transition-all hover:bg-coffee-bean-deep active:scale-[0.99] disabled:opacity-40"
                      style={{ color: "var(--color-porcelain)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}>
                      {submitting ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : <><ChevronRight size={14} strokeWidth={2.5} />Place Order</>}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Payment panel */}
        {leftPanel === "payment" && orderedId && (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
            <ShieldCheck size={40} strokeWidth={1.5} className="text-cool-steel opacity-60" />
            <div className="text-center">
              <p className="favo-label text-cool-steel mb-1">Amount due</p>
              <p className="favo-h2 text-porcelain">{formatZar(totalZar)}</p>
              <p className="favo-small text-cool-steel mt-1">Card handled securely by Yoco</p>
            </div>
            {!yocoClientSecret && (
              <p className="favo-small text-[var(--color-warning)] text-center">
                Yoco not configured — add NEXT_PUBLIC_YOCO_PUBLIC_KEY to take card payments.
              </p>
            )}
            <div className="flex flex-col gap-3 w-full max-w-[280px]">
              <button type="button" onClick={handlePaymentSuccess}
                className="flex w-full items-center justify-center rounded-[4px] py-4 min-h-[52px]"
                style={{ background: "var(--color-success)", color: "var(--color-porcelain)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}>
                <CheckCircle size={16} strokeWidth={2} className="mr-2" />
                Confirm Order Paid
              </button>
              <button type="button" onClick={() => setLeftPanel("menu")}
                className="favo-small text-cool-steel underline underline-offset-2 hover:text-porcelain min-h-[40px] transition-colors">
                ← Back to order
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ════ RIGHT PANEL — LIVE QUEUE ════ */}
      <div className="flex flex-col" style={{ width: "42%" }}>

        {/* Queue header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-cool-steel/20 shrink-0">
          <div className="flex items-center gap-2">
            {rightView.kind === "order" && (
              <button type="button" onClick={() => { setRightView({ kind: "list" }); setActiveOrder(null); }}
                className="text-cool-steel hover:text-porcelain mr-1">
                <ArrowLeft size={16} strokeWidth={2} />
              </button>
            )}
            <h2 className="favo-h3 text-porcelain">{rightView.kind === "order" ? "Order" : "Queue"}</h2>
            {rightView.kind === "list" && <StreamChip status={status} />}
          </div>
          <button type="button" onClick={handleSignOut} aria-label="Sign out"
            className="flex h-9 w-9 items-center justify-center rounded-[4px] text-cool-steel hover:bg-porcelain/10 hover:text-porcelain transition-colors">
            <LogOut size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Queue list */}
        {rightView.kind === "list" && (
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
            {sortedOrders.map(o => (
              <button key={o.orderId} type="button" onClick={() => openOrder(o.orderId)}
                className={["w-full flex items-center justify-between rounded-[2px] border px-3 py-3 min-h-[64px] text-left transition-all hover:brightness-110 active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot", STATE_CARD[o.state]].join(" ")}>
                <div className="flex items-center gap-2">
                  <span className={["block h-2 w-2 rounded-full shrink-0", STATE_DOT[o.state]].join(" ")} />
                  <div>
                    <p className="favo-small text-porcelain font-semibold">#{o.orderId.slice(-6).toUpperCase()}</p>
                    <p className="favo-caption text-cool-steel">{formatDate(new Date(o.lastUpdatedAt))}</p>
                  </div>
                </div>
                <span className={["favo-caption rounded-[999px] px-2 py-0.5", STATE_BADGE[o.state]].join(" ")}>
                  {STATE_LABEL[o.state]}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Active order detail */}
        {rightView.kind === "order" && (
          <ActiveOrderPanel
            orderId={rightView.orderId}
            order={activeOrder}
            advancing={advancing}
            actionError={actionError}
            showDiscount={showDiscount}
            discountId={discountId}
            discountMsg={discountMsg}
            cancelConfirm={cancelConfirm}
            staffId={staffId}
            onAdvance={handleAdvance}
            onCancel={handleCancel}
            onApplyDiscount={handleApplyDiscount}
            onSetShowDiscount={setShowDiscount}
            onSetDiscountId={setDiscountId}
            onSetCancelConfirm={setCancelConfirm}
          />
        )}
      </div>

      {/* ════ MOD SHEET ════ */}
      {modTarget && (
        <div className="fixed inset-0 z-50 flex items-end bg-coffee-bean/60" onClick={e => e.target === e.currentTarget && setModTarget(null)}>
          <div className="w-full max-w-[560px] mx-auto rounded-t-[2px] border-t border-cool-steel/20 bg-dark-teal p-5">
            <p className="favo-h3 text-porcelain mb-1">{modTarget.name}</p>
            <p className="favo-small text-cool-steel mb-3">{formatZar(modTarget.currentPriceZar)} — add-ons</p>
            {modTarget.customisations.length === 0
              ? <p className="favo-small text-cool-steel mb-4">No customisations.</p>
              : (
                <ul className="grid grid-cols-2 gap-2 mb-4">
                  {modTarget.customisations.map(mod => {
                    const on = selectedMods.some(m => m.id === mod.id);
                    return (
                      <li key={mod.id}>
                        <button type="button" onClick={() => toggleMod(mod)} aria-pressed={on}
                          className={["flex w-full items-center justify-between rounded-[2px] border px-3 py-2 min-h-[44px] transition-colors",
                            on ? "border-crimson-carrot bg-crimson-carrot/10 text-porcelain" : "border-cool-steel/30 bg-porcelain/5 text-porcelain hover:bg-porcelain/10"
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
            <button type="button" onClick={confirmAdd}
              className="flex w-full items-center justify-center rounded-[4px] py-3 min-h-[48px]"
              style={{ background: "var(--color-crimson-carrot)", color: "var(--color-porcelain)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}>
              Add to order
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Active Order Panel ───────────────────────────────────────────────────────
function ActiveOrderPanel({
  orderId, order, advancing, actionError, showDiscount, discountId,
  discountMsg, cancelConfirm, staffId,
  onAdvance, onCancel, onApplyDiscount,
  onSetShowDiscount, onSetDiscountId, onSetCancelConfirm
}: {
  orderId: string; order: Order | null; advancing: boolean; actionError: string | null;
  showDiscount: boolean; discountId: string; discountMsg: string | null;
  cancelConfirm: boolean; staffId: string;
  onAdvance: (o: Order) => void; onCancel: (o: Order) => void;
  onApplyDiscount: (o: Order) => void;
  onSetShowDiscount: (v: boolean) => void; onSetDiscountId: (v: string) => void;
  onSetCancelConfirm: (v: boolean) => void;
}) {
  // Load full order on mount
  const [loadedOrder, setLoadedOrder] = useState<Order | null>(order);
  const [loading, setLoading] = useState(!order);

  useEffect(() => {
    if (order) { setLoadedOrder(order); setLoading(false); return; }
    fetch(`/api/pos/order/${orderId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.order) setLoadedOrder(d.order); })
      .finally(() => setLoading(false));
  }, [orderId, order]);

  // Keep in sync with parent's advancing state
  const curr = loadedOrder;
  const isDone = curr?.state === "collected" || curr?.state === "cancelled";
  const nextState = curr ? STATE_NEXT[curr.state] : undefined;
  const isReady = curr?.state === "ready";

  if (loading) return (
    <div className="flex flex-1 items-center justify-center text-cool-steel gap-2">
      <Loader2 size={18} strokeWidth={2} className="animate-spin" />
      <span className="favo-small">Loading…</span>
    </div>
  );
  if (!curr) return (
    <div className="flex flex-1 items-center justify-center">
      <p className="favo-small text-cool-steel">Order not found.</p>
    </div>
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Meta */}
        <div className="flex items-center justify-between">
          <div>
            <p className="favo-label text-cool-steel">#{curr.id.slice(-6).toUpperCase()}</p>
            <p className="favo-caption text-cool-steel">{formatDate(new Date(curr.placedAt))}</p>
          </div>
          <span className={["favo-caption rounded-[999px] px-2 py-0.5", STATE_BADGE[curr.state]].join(" ")}>
            {STATE_LABEL[curr.state]}
          </span>
        </div>
        {curr.customerName && (
          <p className="favo-small text-cool-steel">Customer: <span className="text-porcelain font-semibold">{curr.customerName}</span></p>
        )}

        {/* Items */}
        <div className="rounded-[2px] border border-cool-steel/20 bg-porcelain/5 divide-y divide-cool-steel/10">
          {curr.items.map(item => (
            <div key={item.id} className="flex justify-between px-3 py-2">
              <div>
                <p className="favo-small text-porcelain font-semibold">
                  {item.quantity > 1 && <span className="text-crimson-carrot mr-1">{item.quantity}×</span>}
                  {item.menuItemName || `Item #${item.id.slice(-4)}`}
                </p>
                {item.modifications.length > 0 && <p className="favo-caption text-cool-steel">{item.modifications.map(m => m.name).join(", ")}</p>}
              </div>
              <span className="favo-small text-porcelain shrink-0 ml-3">
                {formatZar((item.unitPriceZar + item.modifications.reduce((s, m) => s + m.priceDeltaZar, 0)) * item.quantity)}
              </span>
            </div>
          ))}
          <div className="flex justify-between px-3 py-2">
            <span className="favo-caption text-cool-steel">TOTAL</span>
            <span className={["favo-small font-semibold", curr.isStaffDiscount ? "text-[var(--color-success)]" : "text-porcelain"].join(" ")}>
              {curr.isStaffDiscount ? "FREE (staff)" : formatZar(curr.totalZar)}
            </span>
          </div>
        </div>

        {/* Error */}
        {actionError && (
          <div className="flex items-center gap-2 text-[var(--color-error)]" role="alert">
            <AlertCircle size={13} strokeWidth={2} />
            <span className="favo-small">{actionError}</span>
          </div>
        )}

        {/* Staff discount */}
        {!isDone && !curr.isStaffDiscount && (
          <div>
            {!showDiscount ? (
              <button type="button" onClick={() => onSetShowDiscount(true)}
                className="flex items-center gap-1 text-cool-steel hover:text-porcelain min-h-[36px] transition-colors favo-small">
                <Tag size={13} strokeWidth={2} /> Apply staff discount
              </button>
            ) : (
              <div className="rounded-[2px] border border-cool-steel/20 bg-porcelain/5 p-3 space-y-2">
                <label htmlFor="did" className="favo-label text-cool-steel">Staff ID</label>
                <input id="did" type="text" value={discountId} onChange={e => onSetDiscountId(e.target.value)} placeholder="uuid"
                  className="w-full rounded-[4px] border border-cool-steel/30 bg-porcelain/10 px-2 py-1.5 text-porcelain favo-small min-h-[36px] focus:border-crimson-carrot focus:outline-none" />
                {discountMsg && <p className={["favo-small", discountMsg.startsWith("✓") ? "text-[var(--color-success)]" : "text-[var(--color-error)]"].join(" ")}>{discountMsg}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => onApplyDiscount(curr)}
                    className="flex-1 rounded-[4px] py-1.5 favo-small min-h-[36px]"
                    style={{ background: "var(--color-crimson-carrot)", color: "var(--color-porcelain)", fontWeight: 700 }}>
                    Apply
                  </button>
                  <button type="button" onClick={() => { onSetShowDiscount(false); onSetDiscountId(""); }}
                    className="rounded-[4px] border border-cool-steel/30 px-3 py-1.5 text-cool-steel hover:bg-porcelain/10 min-h-[36px]">
                    <X size={13} strokeWidth={2} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Cancel */}
        {curr.state === "ordered" && !cancelConfirm && (
          <button type="button" onClick={() => onSetCancelConfirm(true)}
            className="favo-small text-cool-steel underline underline-offset-2 hover:text-[var(--color-error)] min-h-[36px] transition-colors">
            Cancel order
          </button>
        )}
        {curr.state === "ordered" && cancelConfirm && (
          <div className="flex items-center gap-2">
            <span className="favo-small text-[var(--color-error)]">Cancel this order?</span>
            <button type="button" onClick={() => onCancel(curr)}
              className="favo-small rounded-[4px] border border-[var(--color-error)]/50 px-3 py-1 min-h-[36px] text-[var(--color-error)] hover:bg-[var(--color-error)]/10">
              Yes
            </button>
            <button type="button" onClick={() => onSetCancelConfirm(false)}
              className="favo-small text-cool-steel hover:text-porcelain min-h-[36px] px-2 transition-colors">
              Keep
            </button>
          </div>
        )}

        {/* Completed */}
        {isDone && (
          <div className="flex flex-col items-center gap-2 py-4" role="status">
            <CheckCircle size={36} strokeWidth={2} className="text-[var(--color-success)]" />
            <p className="favo-small text-porcelain font-semibold">
              {curr.state === "collected" ? "Collected ✓" : "Cancelled"}
            </p>
          </div>
        )}
      </div>

      {/* Primary action — pinned to bottom */}
      {!isDone && nextState && (
        <div className="px-4 pb-4 shrink-0">
          <button type="button" onClick={() => onAdvance(curr)} disabled={advancing}
            className={["w-full flex items-center justify-center gap-2 rounded-[4px] transition-all active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-porcelain disabled:opacity-40",
              isReady ? "min-h-[72px]" : "min-h-[56px]"
            ].join(" ")}
            style={{
              background: isReady ? "var(--color-success)" : "var(--color-crimson-carrot)",
              color: "var(--color-porcelain)",
              fontFamily: "var(--font-sans)",
              fontWeight: 700,
              fontSize: isReady ? "var(--text-h3)" : "var(--text-small)",
              letterSpacing: isReady ? "0.06em" : "var(--tracking-cta)",
              textTransform: "uppercase",
            }}>
            {advancing
              ? <Loader2 size={20} strokeWidth={2} className="animate-spin" />
              : isReady
              ? <><CheckCircle size={22} strokeWidth={2} />DONE — Collected</>
              : <>{ADVANCE_LABEL[curr.state]}<ChevronRight size={15} strokeWidth={2.5} /></>
            }
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Stream status chip ───────────────────────────────────────────────────────
function StreamChip({ status }: { status: string }) {
  if (status === "connected") return (
    <span className="flex items-center gap-1 rounded-[999px] bg-[var(--color-success)]/10 px-2 py-0.5">
      <Wifi size={10} strokeWidth={2.5} className="text-[var(--color-success)]" />
      <span className="favo-caption text-[var(--color-success)]">Live</span>
    </span>
  );
  if (status === "offline") return (
    <span className="flex items-center gap-1 rounded-[999px] bg-[var(--color-error)]/10 px-2 py-0.5">
      <WifiOff size={10} strokeWidth={2.5} className="text-[var(--color-error)]" />
      <span className="favo-caption text-[var(--color-error)]">Offline</span>
    </span>
  );
  return (
    <span className="flex items-center gap-1 rounded-[999px] bg-porcelain/10 px-2 py-0.5">
      <RefreshCw size={10} strokeWidth={2.5} className="text-cool-steel animate-spin" />
      <span className="favo-caption text-cool-steel">Reconnecting</span>
    </span>
  );
}
