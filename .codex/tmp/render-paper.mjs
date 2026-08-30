import { readFileSync, writeFileSync } from "node:fs";

const p = JSON.parse(readFileSync("final-paper.json", "utf8"));
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const scheme = new Map(p.markScheme.items.map((i) => [i.questionId, i]));
const flaws = JSON.parse(readFileSync("align-issues.json", "utf8"));
// Section D is Psychopathology on Paper 1. The profile said Approaches, which
// is Paper 2, and this map repeated it rather than questioning it.
const SECTION_TITLES = { A: "Social influence", B: "Memory", C: "Attachment", D: "Psychopathology (paper says Approaches)" };

const points = (item) => `
  <ol class="pts">${item.points.map((pt) => `
    <li>
      <div class="pt-head">
        <span class="code code-${esc(pt.code || "B")}">${esc(pt.code || "B")}</span>
        <span class="pt-marks">${pt.marks} mark${pt.marks === 1 ? "" : "s"}</span>
      </div>
      <p>${esc(pt.text)}</p>
      ${(pt.allow || []).length ? `<p class="tag"><span class="allow">Allow</span> ${esc(pt.allow.join("; "))}</p>` : ""}
      ${(pt.reject || []).length ? `<p class="tag"><span class="reject">Reject</span> ${esc(pt.reject.join("; "))}</p>` : ""}
    </li>`).join("")}
  </ol>`;

const bandTable = (item) => `
  <table class="bands">
    <thead><tr><th scope="col">Marks</th><th scope="col">Band</th><th scope="col">Descriptor</th></tr></thead>
    <tbody>${[...item.bands].sort((a, b) => b.minMarks - a.minMarks).map((b) => `
      <tr>
        <td class="rng">${b.minMarks === b.maxMarks ? b.minMarks : `${b.minMarks}&ndash;${b.maxMarks}`}</td>
        <td class="lvl">${esc(b.label)}</td>
        <td>${esc(b.descriptor)}</td>
      </tr>`).join("")}
    </tbody>
  </table>`;

const panel = (q) => {
  const item = scheme.get(q.id);
  if (!item) return "";
  return `
  <div class="mk" id="mk-${esc(q.id)}" hidden>
    <div class="mk-rule"><span>Mark scheme</span><span class="mk-model">${esc(item.marking)}</span></div>
    ${(flaws[q.id] || []).map((f) => `<p class="flaw"><span>${esc(f.code)}</span> ${esc(f.detail)}</p>`).join("")}
    ${item.answer ? `<p class="model">${esc(item.answer)}</p>` : ""}
    ${item.marking === "banded" && item.bands ? bandTable(item) : ""}
    ${item.points && item.points.length ? points(item) : ""}
    ${(item.acceptableAlternatives || []).length ? `<div class="note-blk"><h4>Acceptable alternatives</h4><ul>${item.acceptableAlternatives.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
    ${(item.commonMistakes || []).length ? `<div class="note-blk"><h4>Common mistakes</h4><ul>${item.commonMistakes.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
  </div>`;
};

const bySection = {};
for (const q of p.questions) (bySection[q.section || "?"] ||= []).push(q);

const sections = Object.entries(bySection).map(([id, qs]) => {
  const total = qs.reduce((a, q) => a + q.marks, 0);
  return `
  <section class="sec">
    <div class="sec-head">
      <h2><span class="sec-id">Section ${esc(id)}</span> ${esc(SECTION_TITLES[id] || "")}</h2>
      <span class="sec-marks">${qs.map((q) => q.marks).join(" + ")} = ${total}</span>
    </div>
    ${qs.map((q) => `
    <article class="q">
      <div class="q-num">${p.questions.indexOf(q) + 1}</div>
      <div class="q-body">
        <p>${esc(q.prompt)}</p>
        <button class="reveal" type="button" data-target="mk-${esc(q.id)}" aria-expanded="false">Mark scheme</button>${flaws[q.id] ? ` <span class="flag">${flaws[q.id].length} fault${flaws[q.id].length === 1 ? "" : "s"}</span>` : ""}
        ${panel(q)}
      </div>
      <div class="q-marks">[${q.marks}]</div>
    </article>`).join("")}
  </section>`;
}).join("");

const structure = Object.entries(bySection).map(([id, qs]) =>
  `<div class="st"><span class="st-id">${esc(id)}</span><span class="st-sum">${qs.map((q) => q.marks).join("+")}</span><span class="st-tot">${qs.reduce((a, q) => a + q.marks, 0)}</span></div>`
).join("");

const totalMarks = p.questions.reduce((a, q) => a + q.marks, 0);

const html = `<title>Psychology Paper 1</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
  :root {
    --paper:#FBFAF6; --ink:#17191C; --soft:#5E6268; --faint:#8B8F94;
    --rule:#E2DFD6; --hair:#EFEDE6; --exam:#F4F1E9; --accent:#8A3324;
    --allow:#2F6146; --reject:#8A3324; --flaw:#A03528; --flawbg:#F7EBE7;
    --serif:"Newsreader","Iowan Old Style",Palatino,Georgia,serif;
    --sans:"IBM Plex Sans",ui-sans-serif,system-ui,"Segoe UI",sans-serif;
    --mono:"IBM Plex Mono",ui-monospace,"SFMono-Regular",Menlo,monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper:#141519; --ink:#E7E5DE; --soft:#A3A6AC; --faint:#787C82;
      --rule:#2C2E34; --hair:#212329; --exam:#1B1D23; --accent:#D9887A;
      --allow:#7FBFA0; --reject:#D9887A; --flaw:#E5907E; --flawbg:#2A1E1C;
    }
  }
  :root[data-theme="dark"] {
    --paper:#141519; --ink:#E7E5DE; --soft:#A3A6AC; --faint:#787C82;
    --rule:#2C2E34; --hair:#212329; --exam:#1B1D23; --accent:#D9887A;
    --allow:#7FBFA0; --reject:#D9887A; --flaw:#E5907E; --flawbg:#2A1E1C;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--serif);
       font-size:16.5px;line-height:1.6;-webkit-font-smoothing:antialiased}
  .sheet{max-width:48rem;margin:0 auto;padding:clamp(1.5rem,5vw,3.25rem) clamp(1rem,4vw,2rem) 6rem}

  .cover{border:1.5px solid var(--ink);padding:1.25rem 1.35rem;display:grid;
         grid-template-columns:1fr auto;gap:1rem;align-items:start}
  .cover .board{font-family:var(--sans);font-size:.68rem;letter-spacing:.18em;
                text-transform:uppercase;color:var(--soft)}
  .cover h1{font-size:clamp(1.3rem,3.4vw,1.7rem);margin:.3rem 0 .15rem;font-weight:600;
            letter-spacing:-.015em;text-wrap:balance;line-height:1.2}
  .cover .comp{font-family:var(--sans);font-size:.82rem;color:var(--soft)}
  .cover .facts{font-family:var(--mono);font-size:.78rem;text-align:right;color:var(--soft);
                line-height:1.85;font-variant-numeric:tabular-nums;white-space:nowrap}
  .cover .facts b{color:var(--ink);font-weight:500}

  .structure{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:1rem}
  .st{display:flex;align-items:baseline;gap:.5rem;border:1px solid var(--rule);
      padding:.3rem .6rem;font-family:var(--mono);font-size:.75rem;
      font-variant-numeric:tabular-nums}
  .st-id{font-weight:500;color:var(--ink)}
  .st-sum{color:var(--soft)}
  .st-tot{color:var(--ink);border-left:1px solid var(--rule);padding-left:.5rem}

  .rubric{margin:1.75rem 0 2rem;padding-left:1.1rem;border-left:2px solid var(--rule)}
  .rubric h3{font-family:var(--sans);font-size:.67rem;letter-spacing:.16em;text-transform:uppercase;
             color:var(--faint);margin:0 0 .5rem;font-weight:600}
  .rubric ul{margin:0;padding-left:1.05rem;color:var(--soft);font-size:.93rem}
  .rubric li{margin:.22rem 0}

  .controls{display:flex;justify-content:flex-end;margin-bottom:.5rem}
  .toggle-all{font-family:var(--sans);font-size:.78rem;font-weight:500;color:var(--accent);
              background:none;border:1px solid var(--rule);border-radius:2px;
              padding:.38rem .75rem;cursor:pointer}
  .toggle-all:hover{border-color:var(--accent)}
  .toggle-all:focus-visible,.reveal:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

  .sec{margin-top:2.4rem}
  .sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;
            border-bottom:1.5px solid var(--ink);padding-bottom:.38rem}
  .sec-head h2{font-size:1.02rem;margin:0;font-weight:600;letter-spacing:-.005em}
  .sec-id{font-family:var(--sans);font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;
          color:var(--soft);margin-right:.45rem;font-weight:600}
  .sec-marks{font-family:var(--mono);font-size:.74rem;color:var(--soft);white-space:nowrap;
             font-variant-numeric:tabular-nums}

  .q{display:grid;grid-template-columns:2.1rem 1fr 2.5rem;gap:.55rem;
     padding:1.05rem 0;border-bottom:1px solid var(--hair)}
  .q:last-child{border-bottom:none}
  .q-num{font-family:var(--mono);font-size:.85rem;color:var(--soft);padding-top:.22rem;
         font-variant-numeric:tabular-nums}
  .q-body>p{margin:0}
  .q-marks{font-family:var(--mono);font-size:.82rem;color:var(--soft);text-align:right;
           padding-top:.22rem;font-variant-numeric:tabular-nums}

  .reveal{display:inline-block;margin-top:.6rem;font-family:var(--sans);font-size:.72rem;
          font-weight:500;letter-spacing:.04em;color:var(--accent);background:none;
          border:none;border-bottom:1px solid currentColor;padding:0 0 1px;cursor:pointer}
  .reveal[aria-expanded="true"]{color:var(--soft)}

  .mk{margin-top:.9rem;background:var(--exam);border-left:2px solid var(--accent);
      padding:.9rem 1rem;font-family:var(--sans);font-size:.88rem;line-height:1.55}
  .mk-rule{display:flex;justify-content:space-between;align-items:baseline;
           font-size:.64rem;letter-spacing:.16em;text-transform:uppercase;
           color:var(--accent);font-weight:600;margin-bottom:.6rem}
  .mk-model{font-family:var(--mono);letter-spacing:.04em;color:var(--soft)}
  .model{margin:0 0 .8rem;color:var(--ink)}

  .bands{width:100%;border-collapse:collapse;margin:.35rem 0 .8rem;font-size:.83rem;
         display:block;overflow-x:auto}
  .bands th{text-align:left;font-family:var(--sans);font-size:.64rem;letter-spacing:.13em;
            text-transform:uppercase;color:var(--faint);font-weight:600;
            padding:0 .7rem .35rem 0;border-bottom:1px solid var(--rule)}
  .bands td{padding:.5rem .7rem .5rem 0;border-bottom:1px solid var(--hair);
            vertical-align:top;color:var(--soft)}
  .bands .rng{font-family:var(--mono);color:var(--ink);white-space:nowrap;
              font-variant-numeric:tabular-nums}
  .bands .lvl{font-family:var(--mono);font-size:.78rem;color:var(--soft);white-space:nowrap}

  .pts{margin:.35rem 0 .8rem;padding:0;list-style:none;display:flex;flex-direction:column;gap:.7rem}
  .pts li{padding-left:.85rem;border-left:1px solid var(--rule)}
  .pt-head{display:flex;align-items:center;gap:.5rem;margin-bottom:.2rem}
  .code{font-family:var(--mono);font-size:.66rem;font-weight:500;width:1.2rem;height:1.2rem;
        display:inline-flex;align-items:center;justify-content:center;
        border:1px solid var(--rule);color:var(--soft)}
  .code-A{color:var(--accent);border-color:var(--accent)}
  .pt-marks{font-family:var(--mono);font-size:.7rem;color:var(--faint);
            font-variant-numeric:tabular-nums}
  .pts p{margin:0;color:var(--ink)}
  .tag{margin-top:.28rem;font-size:.8rem}
  .tag .allow{color:var(--allow);font-weight:600;font-size:.68rem;letter-spacing:.1em;
              text-transform:uppercase;margin-right:.3rem}
  .tag .reject{color:var(--reject);font-weight:600;font-size:.68rem;letter-spacing:.1em;
               text-transform:uppercase;margin-right:.3rem}

  .flaw{margin:0 0 .55rem;padding:.45rem .6rem;background:var(--flawbg);
        border-left:2px solid var(--flaw);font-size:.8rem;color:var(--ink)}
  .flaw span{font-family:var(--mono);font-size:.68rem;color:var(--flaw);
             margin-right:.4rem;text-transform:uppercase;letter-spacing:.06em}
  .flag{display:inline-block;margin-left:.5rem;font-family:var(--mono);font-size:.66rem;
        color:var(--flaw);border:1px solid var(--flaw);padding:.05rem .35rem;
        text-transform:uppercase;letter-spacing:.06em}
  .verdict{margin-top:1rem;border:1.5px solid var(--flaw);padding:.85rem 1rem;
           font-family:var(--sans);font-size:.86rem;line-height:1.6;color:var(--ink)}
  .verdict h3{font-size:.66rem;letter-spacing:.16em;text-transform:uppercase;color:var(--flaw);
              margin:0 0 .45rem;font-weight:600}
  .verdict p{margin:0 0 .5rem;max-width:62ch}
  .verdict p:last-child{margin-bottom:0}
  .note-blk{margin-top:.7rem}
  .note-blk h4{font-family:var(--sans);font-size:.64rem;letter-spacing:.13em;text-transform:uppercase;
               color:var(--faint);margin:0 0 .25rem;font-weight:600}
  .note-blk ul{margin:0;padding-left:1.05rem;color:var(--soft);font-size:.84rem}
  .note-blk li{margin:.15rem 0}

  .end{margin-top:2.75rem;text-align:center;font-family:var(--sans);font-size:.68rem;
       letter-spacing:.22em;text-transform:uppercase;color:var(--faint)}

  .prov{margin-top:3.25rem;border-top:1px solid var(--rule);padding-top:1.4rem;
        font-family:var(--sans);font-size:.86rem;color:var(--soft);line-height:1.65}
  .prov h3{font-size:.67rem;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);
           margin:0 0 .7rem;font-weight:600}
  .prov p{margin:0 0 .7rem;max-width:62ch}
  .prov b{color:var(--ink);font-weight:600}
  .prov code{font-family:var(--mono);font-size:.84em;color:var(--ink)}

  @media (max-width:32rem){
    .q{grid-template-columns:1.6rem 1fr 2.2rem}
    .cover{grid-template-columns:1fr}
    .cover .facts{text-align:left}
  }
  @media (prefers-reduced-motion:reduce){*{transition:none !important;animation:none !important}}
</style>

<div class="sheet">
  <header class="cover">
    <div>
      <div class="board">Rejected draft &middot; not fit to sit &middot; not a real exam paper</div>
      <h1>Psychology</h1>
      <div class="comp">A-level Paper 1 &middot; Introductory topics in psychology</div>
    </div>
    <div class="facts">
      Time allowed <b>${p.durationMinutes / 60} hours</b><br>
      Total <b>${totalMarks} marks</b><br>
      <b>${p.questions.length}</b> questions
    </div>
  </header>

  <div class="structure">${structure}</div>

  <div class="verdict">
    <h3>Failed review</h3>
    <p>This paper was generated, passed every structural check, passed a whole-paper audit and a final
    re-audit returning <code>{"pass":true,"issues":[]}</code>, and was published here as a success. It is
    not one. Reviewed against the specification it claims to follow, it fails.</p>
    <p><b>Three questions are marked against a different paper's schemes.</b> Q5 asks what interference is
    and its scheme answers short-term memory encoding and capacity. Q6 asks for an experimental design and
    its scheme answers a serial-position scenario. Q3 asks about a study group and its scheme explains
    recycling, a head student, and figures of 68% and 12% that appear nowhere in the question. A candidate
    would be marked against answers to questions they were never asked.</p>
    <p><b>Section D is the wrong topic.</b> Paper 1 is Social influence, Memory, Attachment and
    Psychopathology. Approaches in Psychology is Paper 2. The stored format profile had the wrong topic
    against the right tariffs, and the whole section was written to it.</p>
    <p>The faults below are flagged by the validator built after this review, which is now part of
    generation and would have blocked this paper. It reports the three mismatched schemes with no false
    positives across the other fifteen questions, and the reversed level numbering on Q12 and Q18.</p>
  </div>

  <div class="rubric">
    <h3>Instructions</h3>
    <ul>${p.instructions.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
  </div>

  <div class="controls">
    <button class="toggle-all" type="button" id="all">Show every mark scheme</button>
  </div>

  ${sections}

  <div class="end">End of questions</div>

  <div class="prov">
    <h3>What this is</h3>
    <p>An original practice paper written by Jami against a verified A-level Psychology
    Paper 1 format profile. It is <b>not a real exam paper</b>, and is not produced by or
    affiliated with any exam board. The questions are new; only the structure is borrowed.</p>
<p>What it did get right is the arithmetic. Every section matches the tariffs the profile recorded
    from a real June 2022 sitting &mdash; <code>3+1+4+16</code>, <code>2+2+4+16</code>,
    <code>2+2+4+16</code> and <code>6+3+2+1+4+8</code>, twenty-four marks each, against ten earlier
    drafts of the same component that came back at 80, 96, 97, 136, 143, 154, 164, 169, 177 and 178
    marks. That was the problem being worked on, and it is solved. It turned out not to be the
    problem that mattered.</p>
    <p><b>Why the wrong schemes were attached.</b> Generation caches each mark-scheme batch under the
    question ids it covers. Every design numbers its questions q1..q18, so an id names a slot rather
    than a question, and when two drafts of the same component wrote to one cache it served the
    earlier paper's schemes for the later paper's questions. The cache key now includes a digest of
    the question text, so a changed prompt can no longer be served an old answer.</p>
    <p>The audit also reported that seventeen questions had no marking guidance, which was false: all
    eighteen were present. An auditor that invents findings and an auditor that misses real ones are
    the same defect, and both happened on this paper. Nothing here has been checked by a subject
    specialist.</p>
  </div>
</div>

<script>
  var KEY = "jami-paper-1-schemes";
  var panels = Array.prototype.slice.call(document.querySelectorAll(".mk"));
  var buttons = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  var all = document.getElementById("all");

  function setOne(button, open) {
    var panel = document.getElementById(button.getAttribute("data-target"));
    if (!panel) return;
    panel.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.textContent = open ? "Hide mark scheme" : "Mark scheme";
  }
  function syncAll() {
    var open = panels.length > 0 && panels.every(function (panel) { return !panel.hidden; });
    all.textContent = open ? "Hide every mark scheme" : "Show every mark scheme";
  }
  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      setOne(button, button.getAttribute("aria-expanded") !== "true");
      syncAll();
    });
  });
  all.addEventListener("click", function () {
    var open = !(panels.length > 0 && panels.every(function (panel) { return !panel.hidden; }));
    buttons.forEach(function (button) { setOne(button, open); });
    syncAll();
    try { localStorage.setItem(KEY, open ? "1" : "0"); } catch (error) { /* storage blocked */ }
  });
  try {
    if (localStorage.getItem(KEY) === "1") {
      buttons.forEach(function (button) { setOne(button, true); });
    }
  } catch (error) { /* storage blocked */ }
  syncAll();
</script>
`;

const out = "C:/Users/jarem/AppData/Local/Temp/claude/c--Users-jarem-jami-flashcards/83ec141e-210c-4922-befe-a37a5bb01d4c/scratchpad/paper1.html";
writeFileSync(out, html);
console.log("written", html.length, "chars ->", out);
