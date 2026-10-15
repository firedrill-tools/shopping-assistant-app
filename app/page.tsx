"use client";

import { useCallback, useEffect, useState } from "react";
import type { Product, ShopState } from "@/lib/store";

type Message = { role: "user" | "assistant"; content: string };
const categories = ["All", "Tabletop", "Bath", "Lighting", "Everyday"];
const tones: Record<string, string> = { Tabletop: "tone-clay", Bath: "tone-sand", Lighting: "tone-olive", Everyday: "tone-blue" };
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default function Page() {
  const [state, setState] = useState<ShopState | null>(null);
  const [category, setCategory] = useState("All");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) throw new Error("Shop state is unavailable");
      setState(await response.json());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load shop"); }
  }, []);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer); }, [refresh]);

  async function cartCommand(body: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/cart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Cart update failed");
      setState(result); setNotice(body.action === "add" ? "Added to cart." : "Removed from cart.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Cart update failed"); await refresh(); }
    finally { setBusy(false); }
  }

  async function checkout() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/checkout", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Checkout failed");
      setState(result.state); setNotice(`Order ${result.order_id} placed for ${money(result.total_cents)}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Checkout failed"); await refresh(); }
    finally { setBusy(false); }
  }

  async function sendChat(text = draft) {
    const content = text.trim();
    if (!content || chatBusy) return;
    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next); setDraft(""); setChatBusy(true);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-12) }) });
      const result = await response.json();
      setMessages([...next, { role: "assistant", content: response.ok ? result.reply || "I could not form a reply." : result.error || "Assistant unavailable." }]);
      await refresh();
    } catch { setMessages([...next, { role: "assistant", content: "Assistant connection failed." }]); }
    finally { setChatBusy(false); }
  }

  const visible = state?.products.filter((product) => category === "All" || product.category === category) || [];
  const cartCount = state?.cart.reduce((count, line) => count + line.quantity, 0) || 0;
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">N</span><span>NOOK</span></div>
      <nav><a href="#collection">Collection</a><a href="#assistant">Ask Nook</a></nav><div className="top-cart">BAG / {String(cartCount).padStart(2, "0")}</div></header>
    <div className="layout">
      <section className="content">
        <div className="hero"><div className="hero-copy"><div className="eyebrow">THE CONSIDERED HOME / 2026</div>
          <h1>Good things,<br/><em>within reach.</em></h1><p>A small collection of useful pieces. Shop with a clear budget, current stock, and an assistant that can help you compare options.</p>
          <a href="#collection" className="hero-link">Explore the collection <span>↗</span></a></div>
          <div className="hero-art"><span className="hero-orbit orbit-one"/><span className="hero-orbit orbit-two"/><span className="hero-object"/><span className="hero-caption">OBJECTS FOR EVERY DAY<br/>NO. 001—006</span></div></div>
        <div className="collection-head" id="collection"><div><div className="eyebrow">THE COLLECTION</div><h2>Made for living.</h2></div>
          <p>Six pieces, selected for quiet utility.</p></div>
        <div className="filters">{categories.map((item) => <button key={item} className={item === category ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
        {!state ? <p className="loading">Loading current stock…</p> : <div className="product-grid">{visible.map((product: Product, index) => <article className="product" key={product.id}>
          <div className={`product-visual ${tones[product.category]}`}><span className="visual-index">0{index + 1} / {product.category.toUpperCase()}</span><span className="product-shape"/><span className="visual-id">{product.id.toUpperCase()}</span></div>
          <div className="product-info"><div><h3>{product.name}</h3><p>{product.description}</p></div><strong>{money(product.price_cents)}</strong></div>
          <div className="product-bottom"><span className={product.stock ? "in-stock" : "sold-out"}>{product.stock ? `${product.stock} available` : "Unavailable"}</span>
            <button disabled={!product.stock || busy} onClick={() => void cartCommand({ action: "add", product_id: product.id, quantity: 1, revision: product.revision })}>{product.stock ? "Add to bag ↗" : "Sold out"}</button></div>
        </article>)}</div>}
      </section>

      <aside className="sidebar"><section className="bag-panel"><div className="panel-top"><div className="eyebrow">YOUR BAG</div><span>{String(cartCount).padStart(2, "0")} ITEMS</span></div>
        <h2>A good fit.</h2><div className="budget"><div><span>YOUR BUDGET</span><strong>{state ? money(state.budget_cents) : "—"}</strong></div>
          <div><span>REMAINING</span><strong>{state ? money(state.remaining_cents) : "—"}</strong></div></div>
        <div className="bag-lines">{!state?.cart.length ? <p className="empty-bag">Your bag is empty. Add a piece from the collection to begin.</p> : state.cart.map((line) => <div className="bag-line" key={line.product_id}><div><strong>{line.name}</strong><small>Qty {line.quantity} · {money(line.price_cents)} each</small></div><button onClick={() => void cartCommand({ action: "remove", product_id: line.product_id })} disabled={busy}>Remove</button></div>)}</div>
        <div className="bag-footer"><div><span>Subtotal</span><strong>{state ? money(state.total_cents) : "—"}</strong></div>
          <button className="checkout" disabled={!state?.cart.length || busy} onClick={() => void checkout()}>Place synthetic order <span>↗</span></button>
          <p>Stock and budget are checked again at checkout.</p></div>
        {error && <div className="error" role="alert">{error}</div>}{notice && <div className="notice" role="status">{notice}</div>}</section>
        <section className="assistant" id="assistant"><div className="assistant-head"><span className="assistant-icon">✦</span><div><div className="eyebrow">SHOPPING COMPANION</div><h2>Ask Nook.</h2></div></div>
          <p>Find alternatives, compare pieces, or check your remaining budget. The assistant can advise; you choose what goes in the bag.</p>
          <div className="messages">{messages.length === 0 ? <div className="prompt-list"><button onClick={() => void sendChat("What is in stock under $40?")}>What is in stock under $40? ↗</button>
            <button onClick={() => void sendChat("What is a good alternative to the linen bath towel?")}>Alternative to the linen towel ↗</button></div> : messages.map((message, index) => <div key={index} className={`message ${message.role}`}>{message.content}</div>)}</div>
          <form onSubmit={(event) => { event.preventDefault(); void sendChat(); }}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about the collection…" aria-label="Ask about the collection"/><button disabled={chatBusy || !draft.trim()} aria-label="Send message">↗</button></form>
          <small>Live chat requires a configured OpenAI model.</small></section></aside>
    </div>
  </main>;
}
