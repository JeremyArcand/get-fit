"use strict";

/* ================================================================
   ONGLET NUTRITION — tout ce qui touche state.nutri : calories,
   macros, eau, poids corporel, journal alimentaire.
   ================================================================ */

/* ================================================================
   DONNÉES INTÉGRÉES PAR CLAUDE — source de vérité pour le journal
   alimentaire. Claude réécrit ce tableau à chaque log et republie
   l'artéfact. Ne pas modifier manuellement dans l'app.
   ================================================================ */
const EMBEDDED_FOOD_LOG = [
  // Aucun aliment loggé pour l'instant.
];

// Le journal alimentaire est réécrit en amont : il fait toujours autorité.
state.nutri.foodLog = EMBEDDED_FOOD_LOG.slice();

/* ================= NAVIGATION DE DATE (NUTRITION) ================= */
document.getElementById("dateNav").addEventListener("click", function(e){
  const btn = e.target.closest("button[data-nav]");
  if(!btn) return;
  const delta = parseInt(btn.dataset.nav,10);
  if(delta === 0){ state.viewDate = todayISO(); }
  else { state.viewDate = addDaysISO(state.viewDate, delta); }
  renderNutrition();
});

/* ================= CALCULS NUTRITION ================= */
function dayTotals(iso){
  const items = state.nutri.foodLog.filter(function(it){ return it.date === iso; });
  const totals = { cal:0, protein:0, carb:0, fat:0 };
  items.forEach(function(it){
    totals.cal += Number(it.cal)||0;
    totals.protein += Number(it.protein)||0;
    totals.carb += Number(it.carb)||0;
    totals.fat += Number(it.fat)||0;
  });
  return totals;
}

/* ================= PONT VERS MON HÉROS ================= */
function ciblesNutrition(){
  return { calories: TARGETS.cal, proteines: TARGETS.protein, eau: TARGETS.water };
}

// null = aucun aliment loggé ce jour-là. L'eau seule ne suffit pas : sans
// calories ni protéines, il n'y a rien à juger.
function totauxNutritionDuJour(iso){
  const items = state.nutri.foodLog.filter(function(it){ return it.date === iso; });
  if(items.length === 0) return null;
  const totaux = dayTotals(iso);
  return {
    calories: totaux.cal,
    proteines: totaux.protein,
    eau: state.nutri.waterLog[iso] || 0
  };
}

function scoreNutritionDuJour(iso){
  const totaux = totauxNutritionDuJour(iso);
  return totaux === null ? null : calculerScoreNutrition(totaux, ciblesNutrition());
}

// Clôture les journées écoulées pas encore évaluées. Jamais aujourd'hui : la
// journée n'est pas finie. Le marqueur garantit qu'un jour ne compte qu'une
// fois, sinon le moral se cumulerait à chaque rechargement de la page.
function cloturerJoursNutrition(){
  const hier = addDaysISO(todayISO(), -1);
  const dernier = HERO.dernierJourNutritionEvalue();

  // Première clôture : on ne remonte pas dans l'historique pour distribuer
  // rétroactivement des pénalités, on démarre à partir de maintenant.
  if(!dernier){
    HERO.marquerJourNutritionEvalue(hier);
    return;
  }

  let jour = addDaysISO(dernier, 1);
  let garde = 0;
  while(jour <= hier && garde++ < 400){
    HERO.evaluerJourNutrition(totauxNutritionDuJour(jour), ciblesNutrition(), jour);
    jour = addDaysISO(jour, 1);
  }
}

function animateNumber(el, from, to, dur){
  const start = performance.now();
  from = Math.round(from); to = Math.round(to);
  if(from === to){ el.textContent = to; return; }
  function step(now){
    const p = Math.min(1, (now-start)/dur);
    const eased = 1 - Math.pow(1-p, 3);
    el.textContent = Math.round(from + (to-from)*eased);
    if(p<1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function renderNutrition(){
  // Placé ici pour couvrir aussi le passage automatique de minuit, qui
  // re-rend cette vue. Sans jour en attente, l'appel ne fait rien.
  cloturerJoursNutrition();

  const iso = state.viewDate;
  const isToday = iso === todayISO();
  document.getElementById("dayTitle").textContent = isToday ? "Aujourd'hui" : formatShortFR(iso);
  document.getElementById("dateSub").textContent = formatLongFR(iso) + (isToday ? "" : " · historique");

  document.querySelectorAll("#dateNav button").forEach(function(b){ b.classList.remove("active"); });
  document.querySelector('#dateNav button[data-nav="0"]').classList.toggle("active", isToday);

  const totals = dayTotals(iso);

  // Anneau calories
  const prevVal = parseInt(document.getElementById("calValue").textContent,10) || 0;
  animateNumber(document.getElementById("calValue"), prevVal, totals.cal, 500);
  document.getElementById("calOfLabel").textContent = "de " + TARGETS.cal + " cal";
  const remaining = TARGETS.cal - totals.cal;
  document.getElementById("calRemaining").textContent = remaining >= 0
    ? remaining + " restantes"
    : Math.abs(remaining) + " en trop";
  document.getElementById("calRemaining").style.color = remaining >= 0 ? "var(--accent-2)" : "var(--fat)";
  setRing(document.getElementById("calRing"), 86, totals.cal / TARGETS.cal);

  // Macros
  renderMacro("macroProtein", totals.protein, TARGETS.protein, "g");
  renderMacro("macroCarb", totals.carb, TARGETS.carb, "g");
  renderMacro("macroFat", totals.fat, TARGETS.fat, "g");

  // Eau
  const water = state.nutri.waterLog[iso] || 0;
  document.getElementById("waterValue").textContent = water.toFixed(2).replace(/\.?0+$/,"").replace(".",",") + " / " + String(TARGETS.water).replace(".",",") + " L";
  document.getElementById("waterFill").style.width = Math.min(100, (water/TARGETS.water)*100) + "%";
  const canEditWater = isToday;
  document.getElementById("waterMinus").style.opacity = canEditWater ? "1" : "0.35";
  document.getElementById("waterPlus").style.opacity = canEditWater ? "1" : "0.35";
  document.getElementById("waterMinus").disabled = !canEditWater;
  document.getElementById("waterPlus").disabled = !canEditWater;

  renderWeight(iso);
  renderHistoryBars();
  renderDiary(iso, isToday);
}

/* ================= POIDS CORPOREL ================= */
function weightEntries(){
  return Object.keys(state.nutri.weightLog)
    .sort()
    .map(function(date){ return { date:date, value:Number(state.nutri.weightLog[date]) }; })
    .filter(function(e){ return e.value > 0; });
}

function renderWeight(iso){
  const input = document.getElementById("weightInput");
  const stored = state.nutri.weightLog[iso];
  if(document.activeElement !== input){
    input.value = stored === undefined ? "" : stored;
  }
  input.placeholder = iso === todayISO() ? "Poids en lb" : "Poids du " + formatShortFR(iso) + " (lb)";

  const entries = weightEntries();
  const latestEl = document.getElementById("weightLatest");
  if(entries.length === 0){
    latestEl.textContent = "—";
    document.getElementById("weightChart").innerHTML =
      '<p class="empty-state">Entre ton poids pour suivre ton évolution.</p>';
    return;
  }
  const last = entries[entries.length-1];
  const diff = last.value - entries[0].value;
  latestEl.innerHTML = fmtWeight(last.value) + " lb" +
    (entries.length > 1
      ? ' <span class="weight-delta">(' + (diff >= 0 ? "+" : "−") + fmtWeight(Math.abs(diff)) + ')</span>'
      : "");

  renderWeightChart(entries.slice(-14));
}

function renderWeightChart(points){
  const el = document.getElementById("weightChart");
  if(points.length < 2){
    el.innerHTML = '<p class="empty-state">Encore une entrée et la courbe apparaîtra.</p>';
    return;
  }
  const w = 320, h = 110, padX = 14, padY = 14;
  const values = points.map(function(p){ return p.value; });
  let min = Math.min.apply(null, values), max = Math.max.apply(null, values);
  if(min === max){ min -= 2; max += 2; }
  const span = max - min;
  min = min - span*0.18;
  max = max + span*0.18;

  function xAt(i){ return padX + (i/(points.length-1)) * (w-padX*2); }
  function yAt(v){ return h - padY - ((v-min)/(max-min)) * (h-padY*2); }

  let path = "", dots = "";
  points.forEach(function(p,i){
    const x = xAt(i), y = yAt(p.value);
    path += (i===0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1) + " ";
    dots += '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="3" fill="var(--accent-2)" stroke="var(--bg-elevated)" stroke-width="1.5"/>';
  });
  const areaPath = path + "L"+xAt(points.length-1).toFixed(1)+","+(h-padY)+" L"+xAt(0).toFixed(1)+","+(h-padY)+" Z";

  el.innerHTML =
    '<svg viewBox="0 0 '+w+' '+h+'" width="100%" height="'+h+'" preserveAspectRatio="none" style="overflow:visible">' +
    '<defs><linearGradient id="weightGrad" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="var(--accent-2)" stop-opacity="0.28"/>' +
    '<stop offset="100%" stop-color="var(--accent-2)" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="'+areaPath+'" fill="url(#weightGrad)" stroke="none"/>' +
    '<path d="'+path+'" fill="none" stroke="var(--accent-2)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    dots +
    '</svg>';
}

document.getElementById("weightSaveBtn").addEventListener("click", function(){
  const input = document.getElementById("weightInput");
  const raw = input.value.trim();
  if(raw === ""){
    delete state.nutri.weightLog[state.viewDate];
  } else {
    const value = Number(raw);
    if(!(value > 0)){ showToast("Entre un poids valide."); return; }
    state.nutri.weightLog[state.viewDate] = Math.round(value*10)/10;
  }
  saveNutri();
  input.blur();
  renderWeight(state.viewDate);
});

function renderMacro(id, val, target, unit){
  const el = document.getElementById(id);
  const ring = el.querySelector(".mring-fg");
  setRing(ring, 26, val/target);
  el.querySelector(".macro-val").textContent = Math.round(val) + " / " + target + unit;
}

function renderHistoryBars(){
  const container = document.getElementById("historyBars");
  container.innerHTML = "";
  const todayIso = todayISO();
  for(let i=6; i>=0; i--){
    const iso = addDaysISO(todayIso, -i);
    const totals = dayTotals(iso);
    const ratio = Math.min(1.2, totals.cal / TARGETS.cal) / 1.2;
    const d = fromISO(iso);
    const col = document.createElement("div");
    col.className = "bar-col";
    const isToday = iso === todayIso;
    const over = totals.cal > TARGETS.cal;
    col.innerHTML =
      '<div class="bar-track"><div class="bar-fill'+(over?' over':'')+'" style="height:'+Math.max(3,ratio*100)+'%"></div></div>' +
      '<span class="bar-label'+(isToday?' today':'')+'">'+WEEKDAYS_FR[d.getDay()]+'</span>';
    container.appendChild(col);
  }
}

function mealIcon(key){
  const icons = {
    dejeuner:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 8h13v5a6.5 6.5 0 0 1-13 0V8Z"/><path d="M17 9.5h1.5a2.5 2.5 0 0 1 0 5H17"/><line x1="4" y1="20" x2="17" y2="20"/></svg>',
    diner:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2"/></svg>',
    souper:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 14A7.5 7.5 0 1 1 10 4.5a6 6 0 0 0 9.5 9.5Z"/></svg>',
    collations:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8.2c-1.4-2-4.6-2.3-6-.3-1.6 2.3-.4 7.6 2.6 10.6 1.3 1.3 2.3 1.5 3.4 1.5s2.1-.2 3.4-1.5c3-3 4.2-8.3 2.6-10.6-1.4-2-4.6-1.7-6 .3Z"/><path d="M12 8c0-1.8.6-3 2-4"/></svg>'
  };
  return icons[key] || "";
}

function renderDiary(iso, isToday){
  const container = document.getElementById("diaryContainer");
  const items = state.nutri.foodLog.filter(function(it){ return it.date === iso; });
  if(items.length === 0){
    container.innerHTML = '<p class="empty-state">Aucun aliment loggé pour cette journée. Écris-moi ce que tu manges et je m\'en occupe.</p>';
    return;
  }
  let html = "";
  MEAL_ORDER.forEach(function(mealKey){
    const mealItems = items.filter(function(it){ return it.meal === mealKey; });
    if(mealItems.length === 0) return;
    const meta = MEAL_META[mealKey];
    html += '<div class="meal-group">';
    html += '<div class="meal-title"><span class="dot" style="background:'+meta.color+'"></span>'+mealIcon(mealKey)+'<span>'+meta.label+'</span></div>';
    mealItems.forEach(function(it){
      html += '<div class="food-item">';
      html += '<div class="food-info"><div class="food-name">'+escapeHtml(it.name)+'</div>';
      html += '<div class="food-meta">'+(it.serving?escapeHtml(it.serving)+" · ":"")+"P "+Math.round(it.protein)+"g · G "+Math.round(it.carb)+"g · L "+Math.round(it.fat)+"g</div></div>";
      html += '<div class="food-cal">'+Math.round(it.cal)+'</div>';
      html += '<button class="food-del" data-del-id="'+it.id+'" '+(isToday?'':'disabled style="opacity:.3"')+'>' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg></button>';
      html += '</div>';
    });
    html += '</div>';
  });
  container.innerHTML = html;
}

document.getElementById("diaryContainer").addEventListener("click", function(e){
  const btn = e.target.closest("button[data-del-id]");
  if(!btn || btn.disabled) return;
  const id = btn.dataset.delId;
  state.nutri.foodLog = state.nutri.foodLog.filter(function(it){ return it.id !== id; });
  renderNutrition();
});

/* ================= EAU ================= */
document.getElementById("waterPlus").addEventListener("click", function(){
  const iso = todayISO();
  state.nutri.waterLog[iso] = Math.round(((state.nutri.waterLog[iso]||0) + 0.25) * 100) / 100;
  saveNutri();
  renderNutrition();
});
document.getElementById("waterMinus").addEventListener("click", function(){
  const iso = todayISO();
  state.nutri.waterLog[iso] = Math.max(0, Math.round(((state.nutri.waterLog[iso]||0) - 0.25) * 100) / 100);
  saveNutri();
  renderNutrition();
});

registerView("nutrition", renderNutrition);
