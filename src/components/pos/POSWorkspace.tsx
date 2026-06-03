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
import { createOrder, transitionOrder, cancelOrder, applyStaffDiscount } from "@/server/actions/orders";
import { useOrderStream } from "@/hooks/useOrderStream";
import { useDraftOrder } from "@/store/draftOrder";
import { formatZar, formatDate } from "@/lib/format";
import {
  Search, X, Plus, Minus, Trash2, ChevronDown, ChevronUp,
  Loader2, Wifi, WifiOff, RefreshCw, Coffee, LogOut,
  CheckCircle, AlertCircle, Tag, Star, ShieldCheck,
} from "lucide-react";
import type { Customer, MenuItem, MenuCustomisation, Order, OrderState } from "@/lib/types";

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
  ordered:     "bg-porcelain/10 text-cool-steel",
  in_progress: "bg-[var(--color-warning)]/20 text-[var(--color-warning)]",
  ready:       "bg-[var(--color-success)]/20 text-[var(--color-success)]",
  collected:   "bg-porcelain/5 text-cool-steel",
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

export default function POSWorkspace({ staffName }: Props) {
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
  const [yocoSecret, setYocoSecret] = useState("");

  // Customer search
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Customer[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { customer, items, totalZar, setCustomer, addItem, removeItem, updateQuantity, reset } = useDraftOrder();

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

  const sortedOrders = [...activeOrders].sort((a, b) => {
    const sp = STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state];
    return sp !== 0 ? sp : b.lastUpdatedAt.localeCompare(a.lastUpdatedAt);
  });

  // Load menu
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

  // Fetch full order when expanded
  async function fetchFullOrder(orderId: string) {
    if (fullOrders[orderId]) return;
    const r = await fetch(`/api/pos/order/${orderId}`);
    if (r.ok) {
      const d = await r.json();
      setFullOrders(prev => ({ ...prev, [orderId]: d.order }));
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
      fetchFullOrder(orderId);
    }
  }

  // ── Order building ─────────────────────────────────────────────────────────
  const grouped = menu.reduce<Record<string, MenuItem[]>>((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  async function handlePlaceOrder() {
    if (items.length === 0 || submitting) return;
    setSubmitting(true); setOrderError(null);
    const r = await createOrder({
      customerId: customer?.id,
      items: items.map(i => ({ menuItemId: i.menuItemId, quantity: i.quantity, modifications: i.modifications.map(m => m.id) })),
    }).catch(() => ({ ok: false as const, code: "ERR", message: "Failed to place order." }));
    setSubmitting(false);
    if (r.ok) {
      setYocoSecret(r.data.yocoClientSecret);
      if (r.data.yocoClientSecret) setShowPayment(true);
      else { reset(); } // No Yoco — order placed, reset left panel
    } else {
      setOrderError(r.message);
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

  async function handleCancel(orderId: string) {
    setCancelConfirm(null);
    setAdvancing(prev => ({ ...prev, [orderId]: true }));
    const r = await cancelOrder(orderId, "Cancelled at POS").catch(() => ({ ok: false as const, code: "ERR", message: "Could not cancel." }));
    setAdvancing(prev => ({ ...prev, [orderId]: false }));
    if (r.ok) {
      setExpandedId(null);
      setFullOrders(prev => { const n = { ...prev }; delete n[orderId]; return n; });
    } else {
      setActionError(prev => ({ ...prev, [orderId]: r.message }));
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

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ════════ LEFT — ORDER BUILDER ════════ */}
      <div className="flex flex-col border-r border-cool-steel/20" style={{ width: "58%" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-cool-steel/20 shrink-0">
          <Image src="/brand/logos/logo-monogram.svg" alt="FAVO" width={28} height={28} className="opacity-80" />
          <span className="favo-label text-cool-steel">New Order</span>
          <span className="favo-small text-cool-steel">{staffName}</span>
        </div>

        {!showPayment ? (
          <>
            {/* Customer search */}
            <div className="px-4 pt-3 pb-2 shrink-0 relative">
              <div className="relative flex items-center">
                <Search size={14} strokeWidth={2} className="absolute left-3 text-cool-steel pointer-events-none" />
                <input type="search" inputMode="text" autoComplete="off"
                  placeholder="Search customer (optional)…"
                  value={query}
                  onChange={e => { setQuery(e.target.value); if (!e.target.value) setCustomer(null); }}
                  onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
                  onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                  className="w-full rounded-[4px] border border-cool-steel/30 bg-porcelain/10 pl-8 pr-8 py-2 text-porcelain placeholder:text-cool-steel favo-small focus:border-crimson-carrot focus:outline-none min-h-[40px]"
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
            <div className="flex gap-1 px-4 pb-2 overflow-x-auto shrink-0">
              {Object.keys(grouped).map(cat => (
                <button key={cat} type="button" onClick={() => setActiveCategory(cat)}
                  className={["favo-caption px-3 py-1 rounded-[999px] transition-colors whitespace-nowrap",
                    activeCategory === cat
                      ? "bg-crimson-carrot"
                      : "bg-porcelain/10 text-cool-steel hover:bg-porcelain/20 hover:text-porcelain"
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
                  <span className="favo-small">Loading…</span>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {(grouped[activeCategory] ?? []).map(item => (
                    <button key={item.id} type="button" onClick={() => { setModTarget(item); setSelectedMods([]); }}
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
              <div className="border-t border-cool-steel/20 px-4 py-3 shrink-0 bg-dark-teal-deep/40">
                <p className="favo-label text-cool-steel mb-2">Order</p>
                <div className="space-y-1.5 max-h-[160px] overflow-y-auto mb-3">
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
                        {item.modifications.length > 0 && (
                          <p className="favo-caption text-cool-steel truncate">{item.modifications.map(m => m.name).join(", ")}</p>
                        )}
                      </div>
                      <span className="favo-small text-porcelain shrink-0">
                        {formatZar((item.unitPriceZar + item.modifications.reduce((s, m) => s + m.priceDeltaZar, 0)) * item.quantity)}
                      </span>
                      <button type="button" onClick={() => removeItem(item.menuItemId)}
                        className="flex h-7 w-7 items-center justify-center text-cool-steel hover:text-[var(--color-error)]">
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
                      className="flex items-center gap-2 rounded-[4px] px-4 py-2 min-h-[40px] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
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
        ) : (
          /* Payment confirmation */
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
            <ShieldCheck size={40} strokeWidth={1.5} className="text-cool-steel opacity-60" />
            <div className="text-center">
              <p className="favo-label text-cool-steel mb-1">Amount due</p>
              <p className="favo-h2 text-porcelain">{formatZar(totalZar)}</p>
              <p className="favo-small text-cool-steel mt-1">Card handled securely by Yoco</p>
            </div>
            <div className="flex flex-col gap-3 w-full max-w-[280px]">
              <button type="button" onClick={() => { reset(); setShowPayment(false); setYocoSecret(""); }}
                className="flex w-full items-center justify-center gap-2 rounded-[4px] py-4 min-h-[52px]"
                style={{ background: "var(--color-success)", color: "var(--color-porcelain)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}>
                <CheckCircle size={16} strokeWidth={2} className="mr-1" />
                Confirm Paid
              </button>
              <button type="button" onClick={() => setShowPayment(false)}
                className="favo-small text-cool-steel underline underline-offset-2 hover:text-porcelain transition-colors">
                ← Back to order
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ════════ RIGHT — LIVE QUEUE ════════ */}
      <div className="flex flex-col" style={{ width: "42%" }}>

        {/* Queue header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-cool-steel/20 shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="favo-h3 text-porcelain">Queue</h2>
            <StreamChip status={status} />
          </div>
          <button type="button" onClick={handleSignOut} aria-label="Sign out"
            className="flex h-9 w-9 items-center justify-center rounded-[4px] text-cool-steel hover:bg-porcelain/10 hover:text-porcelain transition-colors">
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
                  className="w-full flex items-center justify-between px-3 py-3 min-h-[60px] hover:bg-porcelain/5 transition-colors text-left">
                  <div className="flex items-center gap-2">
                    <span className={["block h-2 w-2 rounded-full shrink-0", STATE_DOT[o.state]].join(" ")} />
                    <div>
                      <p className="favo-small text-porcelain font-semibold leading-tight">
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
                  <div className="border-t border-cool-steel/10 px-3 pb-3 pt-2 space-y-2 bg-porcelain/3">

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
                            Customer: <span className="text-porcelain">{full.customerName}</span>
                          </p>
                        )}
                        <div className="space-y-1">
                          {full.items.map(item => (
                            <div key={item.id} className="flex justify-between items-start">
                              <div>
                                <p className="favo-small text-porcelain">
                                  {item.quantity > 1 && <span className="text-crimson-carrot mr-1">{item.quantity}×</span>}
                                  {item.menuItemName || `Item #${item.id.slice(-4)}`}
                                </p>
                                {item.modifications.length > 0 && (
                                  <p className="favo-caption text-cool-steel">{item.modifications.map(m => m.name).join(", ")}</p>
                                )}
                              </div>
                              <span className="favo-small text-porcelain shrink-0 ml-3">
                                {formatZar((item.unitPriceZar + item.modifications.reduce((s, m) => s + m.priceDeltaZar, 0)) * item.quantity)}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-between border-t border-cool-steel/10 pt-1.5">
                          <span className="favo-caption text-cool-steel">TOTAL</span>
                          <span className={["favo-small font-semibold", full.isStaffDiscount ? "text-[var(--color-success)]" : "text-porcelain"].join(" ")}>
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
                          <button type="button" onClick={() => { setShowDiscount(o.orderId); setDiscountMsg(null); setDiscountId(""); }}
                            className="flex items-center gap-1 favo-caption text-cool-steel hover:text-porcelain min-h-[32px] transition-colors">
                            <Tag size={11} strokeWidth={2} /> Apply staff discount
                          </button>
                        ) : (
                          <div className="space-y-1.5 rounded-[2px] border border-cool-steel/20 bg-porcelain/5 p-2">
                            <input type="text" value={discountId} onChange={e => setDiscountId(e.target.value)}
                              placeholder="Staff ID"
                              className="w-full rounded-[2px] border border-cool-steel/30 bg-porcelain/10 px-2 py-1 text-porcelain favo-caption min-h-[32px] focus:border-crimson-carrot focus:outline-none" />
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
                                className="rounded-[2px] border border-cool-steel/30 px-2 text-cool-steel hover:bg-porcelain/10 min-h-[32px]">
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
                          className="favo-caption text-cool-steel hover:text-porcelain min-h-[28px] px-1 transition-colors">
                          Keep
                        </button>
                      </div>
                    )}

                    {/* Collected success */}
                    {full && o.state === "collected" && (
                      <div className="flex items-center gap-2 py-1">
                        <CheckCircle size={14} strokeWidth={2} className="text-[var(--color-success)]" />
                        <span className="favo-small text-porcelain">Collected ✓</span>
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

      {/* ════════ MOD SHEET ════════ */}
      {modTarget && (
        <div className="fixed inset-0 z-50 flex items-end bg-coffee-bean/60"
          onClick={e => e.target === e.currentTarget && setModTarget(null)}>
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
                        <button type="button" onClick={() => setSelectedMods(prev =>
                          prev.some(m => m.id === mod.id) ? prev.filter(m => m.id !== mod.id) : [...prev, mod]
                        )} aria-pressed={on}
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
    </div>
  );
}

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
