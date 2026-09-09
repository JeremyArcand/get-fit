"use strict";

/* ================================================================
   ONGLET ENTRAÎNEMENT — tout ce qui touche state.workout : bâtisseur
   de séance, séries, modèles, minuteur de repos, objectif hebdo,
   streak, records personnels.
   ================================================================ */

const COPY_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5"/></svg>';
const TIMER_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.4 1.5"/><path d="M9.5 2.5h5"/></svg>';

function resetBuilder(){
  state.builder = { name:"", date: todayISO(), exercises:[ newExercise() ] };
}
// Une séance ne peut pas être datée dans le futur.
function normalizeSessionDate(iso){
  const today = todayISO();
  if(typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return today;
  return iso > today ? today : iso;
}
function newExercise(){
  return { id: nextId(), name:"", sets:[ newSet() ] };
}
function newSet(prev){
  return prev ? { reps:prev.reps, weight:prev.weight } : { reps:"", weight:"" };
}
// La séance en cours survit à une fermeture d'onglet (fréquent sur téléphone).
function restoreBuilder(){
  const b = state.workout.builder;
  if(!b || !Array.isArray(b.exercises) || b.exercises.length === 0) return;
  state.builder = {
    name: typeof b.name === "string" ? b.name : "",
    date: normalizeSessionDate(b.date),
    exercises: b.exercises.map(function(ex){
      const sets = Array.isArray(ex.sets) && ex.sets.length
        ? ex.sets.map(function(s){
            return { reps: s.reps === undefined ? "" : s.reps, weight: s.weight === undefined ? "" : s.weight };
          })
        : [ newSet() ];
      return { id: nextId(), name: ex.name || "", sets: sets };
    })
  };
}
let saveTimer = null;
function saveWorkoutSoon(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveWorkout, 400);
}
resetBuilder();
restoreBuilder();

function allExerciseNames(){
  const set = new Set();
  state.workout.sessions.forEach(function(s){
    s.exercises.forEach(function(ex){ if(ex.name && ex.name.trim()) set.add(ex.name.trim()); });
  });
  return Array.from(set).sort(function(a,b){ return a.localeCompare(b,"fr"); });
}

function renderWorkout(){
  document.getElementById("workoutDateSub").textContent = formatLongFR(todayISO());
  renderGoal();
  renderTemplates();
  renderBuilder();
  renderSessionHistory();
  renderExerciseSelect();
  renderProgress();
  renderRecords();
}

/* ================= OBJECTIF HEBDOMADAIRE + STREAK ================= */
function sessionsPerWeek(){
  const counts = {};
  state.workout.sessions.forEach(function(s){
    const start = getWeekRange(s.date).start;
    counts[start] = (counts[start] || 0) + 1;
  });
  return counts;
}

// Semaines consécutives ayant atteint l'objectif, en repartant de la semaine
// dernière : la semaine en cours n'est pas finie, elle ne compte ni ne casse.
function weeklyStreak(){
  const goal = state.workout.weeklyGoal;
  if(!(goal > 0)) return 0;
  const counts = sessionsPerWeek();
  let week = addDaysISO(getWeekRange(todayISO()).start, -7);
  let streak = 0;
  while((counts[week] || 0) >= goal){
    streak++;
    week = addDaysISO(week, -7);
  }
  return streak;
}

function renderGoal(){
  const goal = state.workout.weeklyGoal;
  const week = getWeekRange(todayISO());
  const done = sessionsPerWeek()[week.start] || 0;

  document.getElementById("goalCount").textContent = done;
  document.getElementById("goalOf").textContent = "/ " + goal;
  setRing(document.getElementById("goalRing"), 50, done / goal);

  const input = document.getElementById("weeklyGoalInput");
  if(document.activeElement !== input){ input.value = goal; }

  const streak = weeklyStreak();
  document.getElementById("goalStreak").textContent =
    "🔥 " + streak + " semaine" + (streak > 1 ? "s" : "");

  const remaining = goal - done;
  document.getElementById("goalSub").textContent = remaining <= 0
    ? "Objectif atteint · " + formatShortFR(week.start) + " au " + formatShortFR(week.end)
    : "Encore " + remaining + " séance" + (remaining > 1 ? "s" : "") + " d'ici dimanche";
}

document.getElementById("weeklyGoalInput").addEventListener("change", function(e){
  state.workout.weeklyGoal = normalizeGoal(e.target.value);
  saveWorkout();
  renderGoal();
});

/* ================= MODÈLES DE SÉANCE ================= */
function renderTemplates(){
  const card = document.getElementById("templatesCard");
  const list = document.getElementById("templateList");
  const templates = state.workout.templates;
  card.hidden = templates.length === 0;
  if(templates.length === 0){ list.innerHTML = ""; return; }
  list.innerHTML = templates.map(function(t){
    const count = t.exercises.length;
    return '<span class="template-chip">' +
      '<button class="tpl-use" data-use-template="'+t.id+'">'+escapeHtml(t.name)+
      ' <span style="color:var(--text-tertiary);font-weight:600">· '+count+' ex.</span></button>' +
      '<button class="tpl-del" data-del-template="'+t.id+'" aria-label="Supprimer ce modèle">' +
      '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>' +
      '</button></span>';
  }).join("");
}

document.getElementById("saveTemplateBtn").addEventListener("click", function(){
  const exercises = state.builder.exercises
    .map(function(ex){
      return {
        name: (ex.name||"").trim(),
        sets: ex.sets.map(function(s){ return { reps:Number(s.reps)||0, weight:Number(s.weight)||0 }; })
      };
    })
    .filter(function(ex){ return ex.name !== ""; });

  if(exercises.length === 0){
    showToast("Nomme au moins un exercice avant d'enregistrer un modèle.");
    return;
  }
  const name = (prompt("Nom du modèle :", state.builder.name.trim() || "Mon modèle") || "").trim();
  if(name === "") return;

  state.workout.templates.push({ id: nextId(), name: name, exercises: exercises });
  saveWorkout();
  renderTemplates();
  showToast("Modèle « " + name + " » enregistré.");
});

// Dernières séries réellement effectuées pour un exercice, séance la plus récente d'abord.
function lastPerformance(name){
  const sorted = state.workout.sessions.slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
  for(let i=0; i<sorted.length; i++){
    const ex = sorted[i].exercises.find(function(e){ return e.name === name; });
    if(ex && ex.sets.length) return ex.sets;
  }
  return null;
}

// Un modèle repart des valeurs du dernier entraînement pour pouvoir viser plus haut ;
// à défaut d'historique, il retombe sur les valeurs enregistrées dans le modèle.
function setsForTemplate(ex){
  const last = lastPerformance(ex.name);
  if(last){
    return last.map(function(s){ return { reps:String(s.reps), weight:String(s.weight) }; });
  }
  const base = ex.sets.length ? ex.sets : [null];
  return base.map(function(s){
    if(!s) return newSet();
    return { reps: s.reps ? String(s.reps) : "", weight: s.weight ? String(s.weight) : "" };
  });
}

document.getElementById("templateList").addEventListener("click", function(e){
  const use = e.target.closest("[data-use-template]");
  if(use){
    const tpl = state.workout.templates.find(function(t){ return t.id === use.dataset.useTemplate; });
    if(!tpl) return;
    if(builderHasData() && !confirm("Remplacer la séance en cours par le modèle « "+tpl.name+" » ?")) return;
    let prefilled = 0;
    state.builder = {
      name: tpl.name,
      date: todayISO(),
      exercises: tpl.exercises.map(function(ex){
        if(lastPerformance(ex.name)){ prefilled++; }
        return { id: nextId(), name: ex.name, sets: setsForTemplate(ex) };
      })
    };
    saveWorkout();
    renderBuilder();
    document.querySelector(".builder-card").scrollIntoView({ behavior:"smooth", block:"start" });
    if(prefilled > 0){
      showToast("Valeurs de ton dernier entraînement pré-remplies pour " + prefilled + " exercice" + (prefilled>1?"s":"") + ".");
    }
    return;
  }
  const del = e.target.closest("[data-del-template]");
  if(del){
    const tpl = state.workout.templates.find(function(t){ return t.id === del.dataset.delTemplate; });
    if(!tpl || !confirm("Supprimer le modèle « "+tpl.name+" » ?")) return;
    state.workout.templates = state.workout.templates.filter(function(t){ return t.id !== del.dataset.delTemplate; });
    saveWorkout();
    renderTemplates();
  }
});

/* ================= MINUTEUR DE REPOS ================= */
let restTimer = null;
let restDuration = 90;
let audioCtx = null;
let restDoneTimer = null;

function ensureAudio(){
  try{
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if(!Ctx) return;
    if(!audioCtx){ audioCtx = new Ctx(); }
    if(audioCtx.state === "suspended"){ audioCtx.resume(); }
  }catch(e){ audioCtx = null; }
}

function beep(){
  if(!audioCtx) return;
  try{
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.42);
  }catch(e){}
}

function fmtClock(seconds){
  const s = Math.max(0, Math.ceil(seconds));
  return Math.floor(s/60) + ":" + (s%60 < 10 ? "0" : "") + (s%60);
}

function startRest(seconds){
  // Un seul minuteur à la fois : le nouveau remplace l'ancien.
  clearRestInterval();
  ensureAudio();
  restDuration = seconds;
  restTimer = { endsAt: Date.now() + seconds*1000, interval: setInterval(tickRest, 200) };
  const bar = document.getElementById("restBar");
  bar.classList.remove("is-done");
  bar.hidden = false;
  clearTimeout(restDoneTimer);
  renderRest();
}

function clearRestInterval(){
  if(restTimer){ clearInterval(restTimer.interval); restTimer = null; }
}

function stopRest(){
  clearRestInterval();
  document.getElementById("restBar").hidden = true;
  document.getElementById("restBar").classList.remove("is-done");
}

function tickRest(){
  if(!restTimer) return;
  if(Date.now() >= restTimer.endsAt){ finishRest(); return; }
  renderRest();
}

function finishRest(){
  clearRestInterval();
  const bar = document.getElementById("restBar");
  document.getElementById("restTime").textContent = "0:00";
  document.getElementById("restLabel").textContent = "Repos terminé !";
  document.getElementById("restFill").style.width = "0%";
  bar.classList.add("is-done");
  if(navigator.vibrate){ navigator.vibrate([200,100,200]); }
  beep();
  restDoneTimer = setTimeout(function(){
    bar.classList.remove("is-done");
    bar.hidden = true;
  }, 5000);
}

function renderRest(){
  if(!restTimer) return;
  const remaining = (restTimer.endsAt - Date.now()) / 1000;
  document.getElementById("restTime").textContent = fmtClock(remaining);
  document.getElementById("restLabel").textContent = "Repos en cours";
  document.getElementById("restFill").style.width = Math.max(0, (remaining/restDuration)*100) + "%";
  document.querySelectorAll("#restPresets button").forEach(function(b){
    b.classList.toggle("active", Number(b.dataset.rest) === restDuration);
  });
}

document.getElementById("restStop").addEventListener("click", stopRest);
document.getElementById("restPresets").addEventListener("click", function(e){
  const btn = e.target.closest("[data-rest]");
  if(btn){ startRest(Number(btn.dataset.rest)); }
});

/* ================= RECORDS PERSONNELS ================= */
// Recalculé depuis les séances : aucune donnée supplémentaire n'est stockée.
function computePRs(){
  const prs = {};
  state.workout.sessions
    .slice()
    .sort(function(a,b){ return a.date.localeCompare(b.date); })
    .forEach(function(s){
      s.exercises.forEach(function(ex){
        ex.sets.forEach(function(st){
          const weight = Number(st.weight)||0;
          const reps = Number(st.reps)||0;
          if(weight <= 0) return;
          const cur = prs[ex.name];
          if(!cur || weight > cur.weight || (weight === cur.weight && reps > cur.reps)){
            prs[ex.name] = { weight:weight, reps:reps, date:s.date, sessionId:s.id };
          }
        });
      });
    });
  return prs;
}

function renderRecords(){
  const el = document.getElementById("recordsList");
  const prs = computePRs();
  // Tri alphabétique : classer par charge comparerait des exercices dont les
  // poids saisis ne suivent pas la même convention (machine, halteres, barre).
  const names = Object.keys(prs).sort(function(a,b){ return a.localeCompare(b,"fr"); });
  if(names.length === 0){
    el.innerHTML = '<p class="empty-state">Termine une séance avec des poids pour établir tes premiers records.</p>';
    return;
  }
  el.innerHTML = names.map(function(name){
    const pr = prs[name];
    return '<div class="record-item">' +
      '<span class="record-trophy">🏆</span>' +
      '<div class="record-info">' +
      '<div class="record-name">'+escapeHtml(name)+'</div>' +
      '<div class="record-meta">'+pr.reps+' rép. · '+formatShortFR(pr.date)+'</div>' +
      '</div>' +
      '<div class="record-weight">'+fmtWeight(pr.weight)+' lbs</div>' +
      '</div>';
  }).join("");
}

function renderBuilder(){
  document.getElementById("sessionName").value = state.builder.name;
  const dateInput = document.getElementById("sessionDate");
  dateInput.max = todayISO();
  if(document.activeElement !== dateInput){ dateInput.value = state.builder.date; }
  const list = document.getElementById("exerciseList");
  const names = allExerciseNames();
  let datalistHtml = '<datalist id="exNameList">' + names.map(function(n){ return '<option value="'+escapeHtml(n)+'">'; }).join("") + '</datalist>';
  let html = datalistHtml;
  state.builder.exercises.forEach(function(ex, exIdx){
    html += '<div class="exercise-block" data-ex-id="'+ex.id+'">';
    html += '<div class="exercise-block-head">';
    html += '<input type="text" class="exercise-name-input" list="exNameList" placeholder="Nom de l\'exercice" value="'+escapeHtml(ex.name)+'" data-ex-name="'+ex.id+'">';
    if(state.builder.exercises.length > 1){
      html += '<button class="ex-remove" data-remove-ex="'+ex.id+'"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg></button>';
    }
    html += '</div>';
    html += '<div class="set-labels"><span></span><span>Répétitions</span><span>Poids (lbs)</span><span></span></div>';
    ex.sets.forEach(function(set, sIdx){
      html += '<div class="set-row">';
      html += '<span class="set-idx">'+(sIdx+1)+'</span>';
      html += '<input type="number" min="0" inputmode="numeric" placeholder="0" value="'+escapeAttr(set.reps)+'" data-ex="'+ex.id+'" data-set="'+sIdx+'" data-field="reps">';
      html += '<input type="number" min="0" step="0.5" inputmode="decimal" placeholder="0" value="'+escapeAttr(set.weight)+'" data-ex="'+ex.id+'" data-set="'+sIdx+'" data-field="weight">';
      html += '<div class="set-actions">';
      html += '<button class="set-btn" title="Minuteur de repos" aria-label="Démarrer le minuteur de repos" data-rest-set>'+TIMER_ICON+'</button>';
      html += '<button class="set-btn is-copy" title="Copier cette série" aria-label="Copier cette série" data-copy-set data-ex="'+ex.id+'" data-set="'+sIdx+'">'+COPY_ICON+'</button>';
      if(ex.sets.length > 1){
        html += '<button class="set-btn" title="Supprimer cette série" aria-label="Supprimer cette série" data-remove-set data-ex="'+ex.id+'" data-set="'+sIdx+'"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg></button>';
      }
      html += '</div></div>';
    });
    html += '<button class="add-set-btn" data-add-set="'+ex.id+'">+ Ajouter une série</button>';
    html += '</div>';
  });
  list.innerHTML = html;
}
function escapeAttr(v){ return v===""||v===undefined||v===null ? "" : String(v); }

document.getElementById("sessionName").addEventListener("input", function(e){
  state.builder.name = e.target.value;
  saveWorkoutSoon();
});

document.getElementById("sessionDate").addEventListener("change", function(e){
  state.builder.date = normalizeSessionDate(e.target.value);
  e.target.value = state.builder.date;
  saveWorkout();
});

document.getElementById("addExerciseBtn").addEventListener("click", function(){
  state.builder.exercises.push(newExercise());
  renderBuilder();
  saveWorkout();
});

document.getElementById("exerciseList").addEventListener("input", function(e){
  const t = e.target;
  if(t.matches("[data-ex-name]")){
    const ex = state.builder.exercises.find(function(x){ return x.id === t.dataset.exName; });
    if(ex) ex.name = t.value;
  } else if(t.matches("[data-field]")){
    const ex = state.builder.exercises.find(function(x){ return x.id === t.dataset.ex; });
    if(ex){ ex.sets[parseInt(t.dataset.set,10)][t.dataset.field] = t.value; }
  }
  saveWorkoutSoon();
});

document.getElementById("exerciseList").addEventListener("click", function(e){
  if(e.target.closest("[data-rest-set]")){
    startRest(restDuration);
    return;
  }
  const addSet = e.target.closest("[data-add-set]");
  if(addSet){
    const ex = state.builder.exercises.find(function(x){ return x.id === addSet.dataset.addSet; });
    if(ex){ ex.sets.push(newSet(ex.sets[ex.sets.length-1])); renderBuilder(); saveWorkout(); }
    return;
  }
  const copySet = e.target.closest("[data-copy-set]");
  if(copySet){
    const ex = state.builder.exercises.find(function(x){ return x.id === copySet.dataset.ex; });
    if(ex){
      const i = parseInt(copySet.dataset.set,10);
      ex.sets.splice(i+1, 0, newSet(ex.sets[i]));
      renderBuilder();
      saveWorkout();
    }
    return;
  }
  const removeEx = e.target.closest("[data-remove-ex]");
  if(removeEx){
    state.builder.exercises = state.builder.exercises.filter(function(x){ return x.id !== removeEx.dataset.removeEx; });
    renderBuilder();
    saveWorkout();
    return;
  }
  const removeSet = e.target.closest("[data-remove-set]");
  if(removeSet){
    const ex = state.builder.exercises.find(function(x){ return x.id === removeSet.dataset.ex; });
    if(ex){ ex.sets.splice(parseInt(removeSet.dataset.set,10),1); renderBuilder(); saveWorkout(); }
    return;
  }
});

document.getElementById("finishSessionBtn").addEventListener("click", function(){
  const cleanExercises = state.builder.exercises
    .map(function(ex){
      const cleanSets = ex.sets
        .map(function(s){ return { reps:Number(s.reps)||0, weight:Number(s.weight)||0 }; })
        .filter(function(s){ return s.reps>0 || s.weight>0; });
      return { name:(ex.name||"").trim(), sets:cleanSets };
    })
    .filter(function(ex){ return ex.name && ex.sets.length>0; });

  if(cleanExercises.length === 0){
    alert("Ajoute au moins un exercice avec une série (répétitions ou poids) avant de terminer la séance.");
    return;
  }
  const session = {
    id: nextId(),
    date: normalizeSessionDate(state.builder.date),
    name: state.builder.name.trim() || "Séance",
    exercises: cleanExercises
  };
  const prsBefore = computePRs();
  state.workout.sessions.unshift(session);

  const beaten = [];
  cleanExercises.forEach(function(ex){
    const best = Math.max.apply(null, ex.sets.map(function(s){ return s.weight; }));
    const previous = prsBefore[ex.name];
    if(best > 0 && (!previous || best > previous.weight)){
      beaten.push(ex.name + " " + fmtWeight(best) + " lbs");
    }
  });

  resetBuilder();
  saveWorkout();
  renderWorkout();

  let prMessage = "";
  if(beaten.length > 0){
    const shown = beaten.slice(0,2).join(", ");
    const extra = beaten.length > 2 ? " (+" + (beaten.length-2) + ")" : "";
    prMessage = "🏆 Nouveau record : " + shown + extra;
  }

  // Seule porte d'entrée vers la progression du héros : une séance finalisée.
  // hero.js affiche le message final, record inclus.
  onWorkoutCompleted(session, { hasPR: beaten.length > 0, prMessage: prMessage });
});

function sessionSetCount(session){
  let n = 0;
  session.exercises.forEach(function(ex){ n += ex.sets.length; });
  return n;
}

function renderSessionHistory(){
  const container = document.getElementById("sessionHistory");
  if(state.workout.sessions.length === 0){
    container.innerHTML = '<p class="empty-state">Aucune séance enregistrée. Construis ta première séance ci-dessus.</p>';
    return;
  }
  const prs = computePRs();
  const prSessions = {};
  Object.keys(prs).forEach(function(name){ prSessions[prs[name].sessionId] = true; });

  let html = "";
  // Une séance peut être datée d'hier : on trie plutôt que de se fier à l'ordre d'ajout.
  state.workout.sessions
    .slice()
    .sort(function(a,b){ return b.date.localeCompare(a.date); })
    .forEach(function(session){
    const expanded = !!state.expandedSessions[session.id];
    const badge = prSessions[session.id]
      ? '<span class="pr-badge" title="Record personnel établi lors de cette séance">🏆</span>'
      : '';
    html += '<div class="session-item">';
    html += '<div class="session-head" data-toggle-session="'+session.id+'">';
    html += '<div class="session-head-info"><div class="session-name">'+escapeHtml(session.name)+badge+'</div>';
    const setCount = sessionSetCount(session);
    html += '<div class="session-sub">'+formatShortFR(session.date)+' · '+session.exercises.length+' exercice'+(session.exercises.length>1?'s':'')+' · '+setCount+' série'+(setCount>1?'s':'')+'</div></div>';
    html += '<svg class="session-chevron'+(expanded?' open':'')+'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    html += '<button class="session-del" data-del-session="'+session.id+'"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg></button>';
    html += '</div>';
    html += '<div class="session-detail" '+(expanded?'':'hidden')+'>';
    session.exercises.forEach(function(ex){
      html += '<div class="sd-exercise"><div class="sd-exercise-name">'+escapeHtml(ex.name)+'</div>';
      html += '<div class="sd-sets">'+ex.sets.map(function(s){ return s.reps+" × "+fmtWeight(s.weight)+" lbs"; }).join(" &nbsp;·&nbsp; ")+'</div></div>';
    });
    html += '<button class="repeat-btn" data-repeat-session="'+session.id+'">'+COPY_ICON+'Répéter cette séance</button>';
    html += '</div></div>';
  });
  container.innerHTML = html;
}

function builderHasData(){
  return state.builder.name.trim() !== "" || state.builder.exercises.some(function(ex){
    return (ex.name||"").trim() !== "" || ex.sets.some(function(s){ return s.reps !== "" || s.weight !== ""; });
  });
}

document.getElementById("sessionHistory").addEventListener("click", function(e){
  const repeat = e.target.closest("[data-repeat-session]");
  if(repeat){
    const session = state.workout.sessions.find(function(s){ return s.id === repeat.dataset.repeatSession; });
    if(!session) return;
    if(builderHasData() && !confirm("Remplacer la séance en cours par une copie de « "+session.name+" » ?")) return;
    state.builder = {
      name: session.name,
      date: todayISO(),
      exercises: session.exercises.map(function(ex){
        return {
          id: nextId(),
          name: ex.name,
          sets: ex.sets.map(function(s){ return { reps:String(s.reps), weight:String(s.weight) }; })
        };
      })
    };
    saveWorkout();
    renderBuilder();
    document.querySelector(".builder-card").scrollIntoView({ behavior:"smooth", block:"start" });
    return;
  }
  const del = e.target.closest("[data-del-session]");
  if(del){
    if(confirm("Supprimer cette séance ?")){
      state.workout.sessions = state.workout.sessions.filter(function(s){ return s.id !== del.dataset.delSession; });
      saveWorkout();
      renderWorkout();
    }
    return;
  }
  const head = e.target.closest("[data-toggle-session]");
  if(head){
    const id = head.dataset.toggleSession;
    state.expandedSessions[id] = !state.expandedSessions[id];
    renderSessionHistory();
  }
});

let selectedExercise = null;
function renderExerciseSelect(){
  const select = document.getElementById("exerciseSelect");
  const names = allExerciseNames();
  if(names.length === 0){
    select.innerHTML = '<option value="">Aucun exercice loggé</option>';
    select.disabled = true;
    selectedExercise = null;
    return;
  }
  select.disabled = false;
  if(!selectedExercise || names.indexOf(selectedExercise) === -1){ selectedExercise = names[0]; }
  select.innerHTML = names.map(function(n){
    return '<option value="'+escapeHtml(n)+'"'+(n===selectedExercise?' selected':'')+'>'+escapeHtml(n)+'</option>';
  }).join("");
}
document.getElementById("exerciseSelect").addEventListener("change", function(e){
  selectedExercise = e.target.value;
  renderProgress();
});

function renderProgress(){
  const chartEl = document.getElementById("progressChart");
  const statsEl = document.getElementById("progressStats");
  if(!selectedExercise){
    chartEl.innerHTML = '<p class="empty-state">Logge un exercice pour voir ta progression ici.</p>';
    statsEl.innerHTML = "";
    return;
  }
  const points = [];
  state.workout.sessions
    .filter(function(s){ return s.exercises.some(function(ex){ return ex.name===selectedExercise; }); })
    .forEach(function(s){
      const ex = s.exercises.find(function(ex){ return ex.name===selectedExercise; });
      const maxWeight = Math.max.apply(null, ex.sets.map(function(st){ return st.weight; }));
      points.push({ date:s.date, weight:maxWeight });
    });
  points.sort(function(a,b){ return a.date.localeCompare(b.date); });

  if(points.length === 0){
    chartEl.innerHTML = '<p class="empty-state">Pas encore de données pour cet exercice.</p>';
    statsEl.innerHTML = "";
    return;
  }

  const w = 320, h = 130, padX = 14, padY = 16;
  const weights = points.map(function(p){ return p.weight; });
  let min = Math.min.apply(null, weights), max = Math.max.apply(null, weights);
  if(min === max){ min -= 5; max += 5; }
  min = Math.max(0, min - (max-min)*0.15);
  max = max + (max-min)*0.15;

  function xAt(i){ return points.length===1 ? w/2 : padX + (i/(points.length-1)) * (w-padX*2); }
  function yAt(v){ return h - padY - ((v-min)/(max-min)) * (h-padY*2); }

  let path = "";
  let dots = "";
  points.forEach(function(p,i){
    const x = xAt(i), y = yAt(p.weight);
    path += (i===0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1) + " ";
    dots += '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="3.5" fill="var(--accent-2)" stroke="var(--bg-elevated)" stroke-width="1.5"/>';
  });
  const areaPath = path + "L"+xAt(points.length-1).toFixed(1)+","+(h-padY)+" L"+xAt(0).toFixed(1)+","+(h-padY)+" Z";

  chartEl.innerHTML =
    '<svg viewBox="0 0 '+w+' '+h+'" width="100%" height="'+h+'" preserveAspectRatio="none" style="overflow:visible">' +
    '<defs><linearGradient id="progGrad" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="var(--accent-2)" stop-opacity="0.28"/>' +
    '<stop offset="100%" stop-color="var(--accent-2)" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="'+areaPath+'" fill="url(#progGrad)" stroke="none"/>' +
    '<path d="'+path+'" fill="none" stroke="var(--accent-2)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    dots +
    '</svg>';

  const maxEver = Math.max.apply(null, weights);
  const last = points[points.length-1];
  const first = points[0];
  const diff = last.weight - first.weight;
  statsEl.innerHTML =
    '<div class="pstat"><div class="pstat-val">'+fmtWeight(maxEver)+' lbs</div><div class="pstat-label">Poids max</div></div>' +
    '<div class="pstat"><div class="pstat-val">'+(diff>=0?'+':'−')+fmtWeight(Math.abs(diff))+' lbs</div><div class="pstat-label">Depuis le début</div></div>' +
    '<div class="pstat"><div class="pstat-val">'+formatShortFR(last.date)+'</div><div class="pstat-label">Dernière séance</div></div>';
}

registerView("workout", renderWorkout);
