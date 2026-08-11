// In-page widget: a floating launcher that appears on supported job sites and
// expands into a panel with the Autofill button and a per-field result list.
// Rendered inside a shadow root so the host page's CSS can never touch it (and
// ours can't leak out). Talks to the engine directly — it's all one content world.
(function () {
  const AvidAutofill = (globalThis.AvidAutofill = globalThis.AvidAutofill || {});

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
    .wrap { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; }

    /* palette */
    .wrap {
      --bg: #ffffff; --fg: #14151a; --muted: #6b7280; --border: #e7e9ef;
      --accent: #3a5fe0; --accent-2: #5b8bff; --ok: #12894a; --warn: #b45309;
      --shadow: 0 12px 40px rgba(20,30,60,.22), 0 2px 8px rgba(20,30,60,.12);
    }
    @media (prefers-color-scheme: dark) {
      .wrap {
        --bg: #191b22; --fg: #eceef4; --muted: #9aa2b1; --border: #2b2e3a;
        --accent: #6b93ff; --accent-2: #7ea2ff; --ok: #3ecf8e; --warn: #e0a34a;
        --shadow: 0 12px 40px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.4);
      }
    }

    /* launcher pill */
    .launcher {
      display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
      padding: 11px 16px 11px 13px; border-radius: 999px; border: none;
      background: linear-gradient(135deg, var(--accent-2), var(--accent));
      color: #fff; font-size: 14px; font-weight: 600; box-shadow: var(--shadow);
      transition: transform .18s ease, box-shadow .18s ease; user-select: none;
    }
    .launcher:hover { transform: translateY(-1px); }
    .launcher svg { width: 18px; height: 18px; }
    .launcher.hidden { display: none; }

    /* panel */
    .panel {
      width: 340px; max-width: calc(100vw - 40px); background: var(--bg);
      color: var(--fg); border: 1px solid var(--border); border-radius: 16px;
      box-shadow: var(--shadow); overflow: hidden;
      transform-origin: bottom right; animation: pop .18s cubic-bezier(.2,.9,.3,1.2);
    }
    .panel.hidden { display: none; }
    @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.96); } to { opacity: 1; transform: none; } }

    .head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .mark { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, var(--accent-2), var(--accent));
      display: grid; place-items: center; flex: none; }
    .mark svg { width: 16px; height: 16px; }
    .titles { flex: 1; min-width: 0; }
    .titles b { font-size: 14px; display: block; }
    .badge { font-size: 11px; color: var(--accent); font-weight: 600; }
    .x { border: none; background: none; color: var(--muted); cursor: pointer; font-size: 20px; line-height: 1; padding: 2px 4px; border-radius: 6px; }
    .x:hover { background: var(--border); }

    .body { padding: 14px 16px 16px; }
    .fill {
      width: 100%; padding: 12px; border: none; border-radius: 11px; cursor: pointer;
      background: linear-gradient(135deg, var(--accent-2), var(--accent)); color: #fff;
      font-size: 14px; font-weight: 700; letter-spacing: .1px;
      transition: filter .15s ease, transform .1s ease;
    }
    .fill:hover { filter: brightness(1.05); }
    .fill:active { transform: scale(.99); }
    .fill:disabled { opacity: .6; cursor: default; }

    .toggles { display: flex; flex-direction: column; gap: 7px; margin: 12px 2px 2px; }
    .toggles label { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12.5px; cursor: pointer; }
    .toggles input { accent-color: var(--accent); }

    .summary { font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
    .results { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow-y: auto; }
    .results li { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; border-top: 1px solid var(--border); font-size: 12px; }
    .results .lbl { color: var(--muted); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .results .val { max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .val.ok { color: var(--ok); } .val.warn { color: var(--warn); } .val.err { color: #d1495b; }

    .foot { display: flex; align-items: center; justify-content: space-between; padding: 11px 16px; border-top: 1px solid var(--border); }
    .foot a { color: var(--accent); text-decoration: none; font-size: 12.5px; font-weight: 600; cursor: pointer; }
    .review { color: var(--warn); font-size: 11px; }
    .empty { color: var(--muted); font-size: 12.5px; margin-top: 10px; }
  `;

  const BOLT = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1.5 8.5L20 10h-6.5L15 2z"/></svg>`;

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  let mounted = false;

  function mount(adapter) {
    if (mounted || document.getElementById("avid-autofill-root")) return;
    mounted = true;

    const host = document.createElement("div");
    host.id = "avid-autofill-root";
    const root = host.attachShadow({ mode: "open" });
    (document.body || document.documentElement).appendChild(host);

    const atsLabel = adapter.beta ? `${adapter.name} (beta)` : adapter.name;

    root.appendChild(el(`<style>${STYLE}</style>`));
    const wrap = el(`<div class="wrap"></div>`);
    const launcher = el(
      `<button class="launcher" title="Avid Autofill">${BOLT}<span>Autofill</span></button>`
    );
    const panel = el(`
      <div class="panel hidden">
        <div class="head">
          <div class="mark">${BOLT}</div>
          <div class="titles"><b>Avid Autofill</b><span class="badge">${atsLabel} detected</span></div>
          <button class="x" title="Close">&times;</button>
        </div>
        <div class="body">
          <button class="fill">Autofill this page</button>
          <div class="toggles">
            <label><input type="checkbox" class="ov"> Overwrite fields that already have a value</label>
            <label><input type="checkbox" class="eeo"> Fill voluntary self-ID (EEO)</label>
          </div>
          <div class="summary hidden"></div>
          <ul class="results"></ul>
        </div>
        <div class="foot">
          <a class="opt">Edit my info</a>
          <span class="review">Review before submitting</span>
        </div>
      </div>
    `);
    wrap.append(launcher, panel);
    root.appendChild(wrap);

    const $ = (s) => panel.querySelector(s);
    const open = () => { panel.classList.remove("hidden"); launcher.classList.add("hidden"); syncToggles(); };
    const close = () => { panel.classList.add("hidden"); launcher.classList.remove("hidden"); };

    launcher.addEventListener("click", open);
    $(".x").addEventListener("click", close);
    $(".opt").addEventListener("click", () =>
      chrome.runtime.sendMessage({ type: "AVID_OPEN_OPTIONS" })
    );

    async function syncToggles() {
      const s = await AvidAutofill.getSettings();
      $(".ov").checked = s.overwriteFilled;
      $(".eeo").checked = s.fillEEO;
    }
    async function persistToggles() {
      const s = await AvidAutofill.getSettings();
      s.overwriteFilled = $(".ov").checked;
      s.fillEEO = $(".eeo").checked;
      await AvidAutofill.saveSettings(s);
    }
    $(".ov").addEventListener("change", persistToggles);
    $(".eeo").addEventListener("change", persistToggles);

    $(".fill").addEventListener("click", async () => {
      const btn = $(".fill");
      btn.disabled = true;
      btn.textContent = "Filling…";
      try {
        await persistToggles();
        const profile = await AvidAutofill.getProfile();
        if (!profile.personal.email && !profile.personal.fullName) {
          renderEmpty($);
          return;
        }
        const settings = await AvidAutofill.getSettings();
        const resume = await AvidAutofill.getResume();
        const report = await AvidAutofill.engine.fillPage(profile, settings, resume);
        renderReport($, report);
      } finally {
        btn.disabled = false;
        btn.textContent = "Autofill this page";
      }
    });
  }

  function renderEmpty($) {
    $(".summary").classList.remove("hidden");
    $(".summary").textContent = "No profile saved yet.";
    $(".results").innerHTML =
      `<li class="empty">Click <b>Edit my info</b> below to add your details, then come back and autofill.</li>`;
  }

  function renderReport($, report) {
    const s = $(".summary");
    s.classList.remove("hidden");
    s.textContent = `Filled ${report.filledCount} field${report.filledCount === 1 ? "" : "s"} on ${report.ats}.`;
    const ul = $(".results");
    ul.innerHTML = "";
    if (!report.results.length) {
      ul.innerHTML = `<li class="empty">No matching fields found on this page.</li>`;
      return;
    }
    for (const r of report.results) {
      const done = r.status === "filled" || r.status === "checked";
      const cls = done ? "ok" : r.status === "error" ? "err" : "warn";
      const li = document.createElement("li");
      li.innerHTML =
        `<span class="lbl"></span><span class="val ${cls}"></span>`;
      li.querySelector(".lbl").textContent = r.label;
      const v = li.querySelector(".val");
      v.textContent = done ? r.value : r.status;
      v.title = `${r.value} — ${r.status}`;
      ul.append(li);
    }
  }

  AvidAutofill.widget = { mount };
})();
