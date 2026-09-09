"use strict";

/* ================================================================
   SOCLE COMMUN — état global, constantes, utilitaires de date, thème,
   navigation entre onglets, sauvegarde/restauration.

   Chargé en premier. Les déclarations de ce fichier sont au niveau
   global : les scripts chargés ensuite (nutrition.js, workout.js,
   hero.js) les lisent et les modifient directement.
   ================================================================ */

const TARGETS = { cal:2760, protein:150, carb:401, fat:62, water:3.1 };

const MEAL_META = {
  dejeuner:  { label:"Déjeuner",   color:"#2563EB" },
  diner:     { label:"Dîner",      color:"#14B8A6" },
  souper:    { label:"Souper",     color:"#F59E0B" },
  collations:{ label:"Collations",color:"#8B5CF6" }
};
const MEAL_ORDER = ["dejeuner","diner","souper","collations"];

const WEEKDAYS_FR = ["dim","lun","mar","mer","jeu","ven","sam"];
const MONTHS_FR = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];

/* ---------------- Utilitaires de dates ---------------- */
function pad(n){ return n<10 ? "0"+n : ""+n; }
function toISO(d){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
function todayISO(){ return toISO(new Date()); }
function fromISO(s){ const p=s.split("-").map(Number); return new Date(p[0],p[1]-1,p[2]); }
function addDaysISO(iso,n){ const d=fromISO(iso); d.setDate(d.getDate()+n); return toISO(d); }
function formatLongFR(iso){ const d=fromISO(iso); return d.getDate()+" "+MONTHS_FR[d.getMonth()]; }
// Semaine du lundi au dimanche contenant la date donnée.
function getWeekRange(iso){
  const day = fromISO(iso).getDay();          // 0 = dimanche
  const toMonday = day === 0 ? -6 : 1 - day;
  const start = addDaysISO(iso, toMonday);
  return { start: start, end: addDaysISO(start, 6) };
}
function formatShortFR(iso){ const d=fromISO(iso); return d.getDate()+" "+MONTHS_FR[d.getMonth()].slice(0,3); }


/* ---------------- Chargement des données ---------------- */
const NUTRI_KEY = "nutriTrackerData_v1";
const WORKOUT_KEY = "workoutTrackerData_v1";

function loadNutri(){
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(NUTRI_KEY)) || {}; } catch(e){ stored = {}; }
  return {
    foodLog: [], // rempli par nutrition.js depuis EMBEDDED_FOOD_LOG
    waterLog: stored.waterLog || {},
    weightLog: stored.weightLog || {},
    theme: stored.theme || null
  };
}
function saveNutri(){
  localStorage.setItem(NUTRI_KEY, JSON.stringify({
    waterLog: state.nutri.waterLog,
    weightLog: state.nutri.weightLog,
    theme: state.nutri.theme
  }));
}

const LBS_PER_KG = 2.20462;

// Les poids étaient saisis en kg avant la bascule en lbs : on convertit une
// seule fois les données existantes pour que l'historique reste comparable.
function convertSessionsToLbs(sessions){
  sessions.forEach(function(s){
    (s.exercises||[]).forEach(function(ex){
      (ex.sets||[]).forEach(function(st){
        st.weight = Math.round((Number(st.weight)||0) * LBS_PER_KG * 2) / 2;
      });
    });
  });
}

function loadWorkout(){
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(WORKOUT_KEY)) || {}; } catch(e){ stored = {}; }
  const sessions = stored.sessions || [];
  const templates = stored.templates || [];
  if(stored.unit !== "lbs"){
    convertSessionsToLbs(sessions);
    convertSessionsToLbs(templates);
  }
  return {
    sessions: sessions,
    templates: templates,
    weeklyGoal: normalizeGoal(stored.weeklyGoal),
    builder: stored.builder || null
  };
}
function normalizeGoal(v){
  if(v === "" || v === null || v === undefined) return 4;
  const n = Math.round(Number(v));
  if(!isFinite(n)) return 4;
  return Math.min(14, Math.max(1, n));
}
function saveWorkout(){
  localStorage.setItem(WORKOUT_KEY, JSON.stringify({
    sessions: state.workout.sessions,
    templates: state.workout.templates,
    weeklyGoal: state.workout.weeklyGoal,
    builder: state.builder,
    unit: "lbs"
  }));
}

const HERO_KEY = "heroTrackerData_v1";

// Remet une sauvegarde de héros en forme : un champ manquant ou corrompu
// retombe sur sa valeur par défaut plutôt que de casser l'app.
function normalizeHero(stored){
  const src = stored || {};
  const stats = src.stats || {};
  function num(v, min, fallback){
    const n = Math.round(Number(v));
    return isFinite(n) && n >= min ? n : fallback;
  }
  return {
    name: typeof src.name === "string" && src.name.trim() ? src.name : "Héros",
    level: num(src.level, 1, 1),
    xp: num(src.xp, 0, 0),
    stats: {
      force: num(stats.force, 1, 5),
      endurance: num(stats.endurance, 1, 5),
      vitesse: num(stats.vitesse, 1, 5)
    },
    gold: num(src.gold, 0, 0),
    attackCharges: num(src.attackCharges, 0, 0),
    inventory: Array.isArray(src.inventory) ? src.inventory : [],
    equippedWeaponId: src.equippedWeaponId || null,
    monsterIndex: num(src.monsterIndex, 0, 0),
    currentMonster: src.currentMonster || null // généré par hero.js si absent
  };
}
function loadHero(){
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(HERO_KEY)) || {}; } catch(e){ stored = {}; }
  return normalizeHero(stored);
}
function saveHero(){
  localStorage.setItem(HERO_KEY, JSON.stringify(state.hero));
}

const state = {
  nutri: loadNutri(),
  workout: loadWorkout(),
  hero: loadHero(),
  viewDate: todayISO(),
  activeView: "nutrition",
  builder: { name:"", exercises:[] },
  expandedSessions: {},
  idCounter: 1
};
saveNutri();

function nextId(){ return "id" + (Date.now().toString(36)) + (state.idCounter++); }

/* ================= THÈME ================= */
function applyTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  document.querySelectorAll(".theme-toggle").forEach(function(btn){
    btn.querySelector(".icon-sun").style.display = t==="dark" ? "none" : "block";
    btn.querySelector(".icon-moon").style.display = t==="dark" ? "block" : "none";
  });
}
function initTheme(){
  let t = state.nutri.theme;
  if(!t){ t = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
  applyTheme(t);
}
function toggleTheme(){
  const current = document.documentElement.getAttribute("data-theme");
  const next = current==="dark" ? "light" : "dark";
  applyTheme(next);
  state.nutri.theme = next;
  saveNutri();
}
document.querySelectorAll(".theme-toggle").forEach(function(btn){
  btn.addEventListener("click", toggleTheme);
});
initTheme();

/* ================= NAVIGATION ENTRE ONGLETS ================= */
// Chaque fichier de domaine s'enregistre ici : aucun onglet n'est codé en
// dur, on peut donc en ajouter un sans toucher à ce fichier.
const views = {};

function registerView(id, renderFn){
  views[id] = renderFn;
}
function renderView(id){
  if(views[id]) views[id]();
}
function renderAll(){
  Object.keys(views).forEach(function(id){ views[id](); });
}
function showView(id){
  if(!views[id]) return;
  state.activeView = id;
  document.querySelectorAll(".tab-btn").forEach(function(b){
    b.classList.toggle("active", b.dataset.view === id);
  });
  document.querySelectorAll(".view").forEach(function(section){
    section.hidden = section.id !== "view-" + id;
  });
  renderView(id);
}

document.querySelectorAll(".tab-btn").forEach(function(btn){
  btn.addEventListener("click", function(){ showView(btn.dataset.view); });
});

// Les onglets s'enregistrent pendant l'exécution des scripts suivants :
// on attend la fin du chargement pour le premier rendu.
document.addEventListener("DOMContentLoaded", function(){
  renderAll();
});

/* ================= ROLLOVER AUTOMATIQUE DE JOURNÉE ================= */
let lastKnownToday = todayISO();
setInterval(function(){
  const t = todayISO();
  if(t !== lastKnownToday){
    const wasOnToday = state.viewDate === lastKnownToday;
    lastKnownToday = t;
    if(wasOnToday){ state.viewDate = t; }
    renderView("nutrition");
  }
}, 60000);

function setRing(circle, r, pct){
  const C = 2*Math.PI*r;
  circle.style.strokeDasharray = C;
  const clamped = Math.max(0, Math.min(1, pct));
  circle.style.strokeDashoffset = C * (1-clamped);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}

function fmtWeight(v){
  const n = Math.round((Number(v)||0) * 10) / 10;
  return String(n).replace(".", ",");
}

/* ================= NOTIFICATION PASSAGÈRE ================= */
let toastTimer = null;
function showToast(msg){
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  // Force un reflow pour que la transition parte de l'état masqué.
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){
    el.classList.remove("show");
    setTimeout(function(){ el.hidden = true; }, 300);
  }, 4000);
}

/* ================= SAUVEGARDE / RESTAURATION ================= */
const saveToggle = document.getElementById("saveToggle");
const saveBody = document.getElementById("saveBody");
saveToggle.addEventListener("click", function(){
  const isOpen = !saveBody.hidden;
  saveBody.hidden = isOpen;
  saveToggle.classList.toggle("open", !isOpen);
});

function buildSaveCode(){
  const payload = {
    v:3,
    waterLog: state.nutri.waterLog,
    weightLog: state.nutri.weightLog,
    theme: state.nutri.theme,
    workouts: state.workout.sessions,
    templates: state.workout.templates,
    weeklyGoal: state.workout.weeklyGoal,
    unit: "lbs"
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}
document.getElementById("genCodeBtn").addEventListener("click", function(){
  const code = buildSaveCode();
  const out = document.getElementById("saveOutput");
  out.value = code;
  const note = document.getElementById("saveNote");
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(code).then(function(){
      note.textContent = "Code copié dans le presse-papiers.";
    }).catch(function(){
      note.textContent = "Code généré — copie-le manuellement.";
    });
  } else {
    out.select();
    note.textContent = "Code généré — copie-le manuellement.";
  }
});
document.getElementById("restoreBtn").addEventListener("click", function(){
  const raw = document.getElementById("restoreInput").value.trim();
  const note = document.getElementById("saveNote");
  if(!raw){ note.textContent = "Colle d'abord un code de sauvegarde."; return; }
  try{
    const payload = JSON.parse(decodeURIComponent(escape(atob(raw))));
    state.nutri.waterLog = payload.waterLog || {};
    state.nutri.weightLog = payload.weightLog || {};
    if(payload.theme){ state.nutri.theme = payload.theme; applyTheme(payload.theme); }
    if(payload.workouts){
      if(payload.unit !== "lbs"){ convertSessionsToLbs(payload.workouts); }
      state.workout.sessions = payload.workouts;
    }
    if(payload.templates){
      if(payload.unit !== "lbs"){ convertSessionsToLbs(payload.templates); }
      state.workout.templates = payload.templates;
    }
    if(payload.weeklyGoal !== undefined){
      state.workout.weeklyGoal = normalizeGoal(payload.weeklyGoal);
    }
    saveNutri();
    saveWorkout();
    renderAll();
    note.textContent = "Restauration réussie.";
    document.getElementById("restoreInput").value = "";
  }catch(e){
    note.textContent = "Ce code est invalide.";
  }
});
