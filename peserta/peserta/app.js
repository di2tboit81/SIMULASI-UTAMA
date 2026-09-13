(function(){
  function setLocalMode(){
    document.body.classList.toggle('local-mode', location.protocol === 'file:');
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', setLocalMode);
  }else{
    setLocalMode();
  }
})();

/* ===== ORIGINAL INLINE SCRIPT BLOCK ===== */

/* ================= DATABASE EXCEL =================
   Bank soal dibaca dari file Excel yang berada satu folder dengan HTML.
   Nama file sengaja dibuat tetap agar database dapat diganti 7000 -> 8000 -> dst
   tanpa perlu mengubah file HTML.
*/

function updateLocalDbButtonVisibility(){
  const btn = document.getElementById("chooseLocalExcel");
  if(!btn) return;
  const online = /^https?:$/i.test(location.protocol);
  btn.classList.toggle("online-hidden", online);
}
const DB_FILE_NAME = "DATABASE_SKD_IPDN_CPNS_2026.xlsx";
let BANK = [];
let bankLoadPromise = null;

function normalizeQuestion(text){
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g," ")
    .trim();
}

function cleanQuestionDisplay(text){
  return String(text ?? "")
    // Hapus semua keterangan varian di dalam tanda kurung.
    .replace(/\s*\(\s*varian\b[^)]*\)/gi, "")
    // Hapus SEMUA isi metadata yang berada di dalam tanda kurung siku [ ... ].
    // Contoh: [P-55], [TKP-232], [TIU-001], [kode apa pun], dll.
    .replace(/\s*\[[^\]]*\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function excelRowToQuestion(row, index){
  const cat = String(row.Kategori ?? "").trim().toUpperCase();
  const level = String(row.Tingkat_Baru ?? row.Tingkat ?? "").trim();
  const q = String(row.Soal ?? "").trim();
  const opts = ["A","B","C","D","E"].map(k=>String(row[k] ?? "").trim());
  const letter = String(row.Jawaban ?? "").trim().toUpperCase();
  const ans = "ABCDE".indexOf(letter);
  if(!["TWK","TIU","TKP"].includes(cat) || !q || opts.some(v=>!v) || ans<0) return null;
  return {
    cat,
    q,
    opts,
    ans,
    exp:String(row.Pembahasan ?? "").trim(),
    diff:level,
    id:String(row.ID ?? ("ROW-"+index)),
    source:String(row.ExamGroup ?? "DATABASE EXCEL"),
    sourceNote:String(row.SourceType ?? "DATABASE EXCEL")
  };
}

async function loadBankFromExcel(fileOverride=null){
  if(window.__BANK_READY && !fileOverride) return BANK;

  try{
    let arrayBuffer;

    if(fileOverride){
      arrayBuffer = await fileOverride.arrayBuffer();
    }else{
      const url = DB_FILE_NAME + "?v=" + Date.now();
      const response = await fetch(url, {cache:"no-store"});
      if(!response.ok) throw new Error("HTTP " + response.status);
      arrayBuffer = await response.arrayBuffer();
    }

    const workbook = XLSX.read(arrayBuffer,{type:"array"});
    const sheetName = workbook.SheetNames.includes("BANK_SOAL")
      ? "BANK_SOAL"
      : workbook.SheetNames[0];

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{defval:""});

    const normalize = v => String(v ?? "").trim();

    // SATU BARIS VALID DI EXCEL = SATU SOAL.
    // Soal dengan teks sama tetap dipertahankan sebagai record terpisah.
    BANK = rows.map((r,idx)=>{
      const question = normalize(r.Soal || r.soal || r.Question || r.question);
      if(!question) return null;

      const opts = [
        normalize(r.A), normalize(r.B), normalize(r.C),
        normalize(r.D), normalize(r.E)
      ];
      const answerLetter = normalize(r.Jawaban || r.JAWABAN).toUpperCase().charAt(0);
      const answerIndex = "ABCDE".indexOf(answerLetter);
      if(!["TWK","TIU","TKP"].includes(
        normalize(r.Kategori || r.KATEGORI || r.KategoriSoal).toUpperCase()
      ) || !question || opts.some(v=>!v) || answerIndex < 0) return null;

      return {
        id: normalize(r.ID || r.Id || r.id) || ("EXCEL-"+(idx+1)),
        cat: normalize(r.Kategori || r.KATEGORI || r.KategoriSoal).toUpperCase(),
        sub: normalize(r.Submateri || r.SUBMATERI),
        level: normalize(r.Tingkat_Baru || r.Tingkat || r.TINGKAT).toLowerCase(),
        q: question,
        opts,
        ans: answerIndex,
        exp: normalize(r.Pembahasan || r.PEMBAHASAN)
      };
    }).filter(Boolean);

    // Database final memakai pemilihan acak langsung dari pool level+kategori.
    // Bersihkan antrean database versi lama agar tidak tercampur.
    try{
      ["mudah","sedang","sulit","super sulit"].forEach(l=>{
        ["TWK","TIU","TKP"].forEach(c=>{
          localStorage.removeItem("skd_queue_excel_question_"+l+"_"+c);
        });
      });
    }catch(e){}
    // VALIDASI DATABASE FINAL: 45.000 soal dengan komposisi yang ditetapkan.
    const finalCounts = {
      TWK:{Mudah:1000,Sedang:3000,Sulit:5500,"Super Sulit":5500},
      TIU:{Mudah:1000,Sedang:3000,Sulit:5500,"Super Sulit":5500},
      TKP:{Mudah:1000,Sedang:3000,Sulit:5500,"Super Sulit":5500}
    };
    const dbCount = BANK.length;
    const dbExpected = 45000;
    const dbInvalidDistribution = Object.entries(finalCounts).some(([cat, levels]) =>
      Object.entries(levels).some(([level, expected]) =>
        BANK.filter(q => q.cat===cat && q.level===level.toLowerCase()).length !== expected
      )
    );
    if(dbCount !== dbExpected || dbInvalidDistribution){
      console.warn("⚠️ DATABASE FINAL TERBACA, tetapi distribusi tidak sesuai target:", {
        total: dbCount, expected: dbExpected, invalidDistribution: dbInvalidDistribution
      });
    }

    window.__BANK_READY = true;
    window.__DB_SOURCE = fileOverride ? "LOCAL" : "ONLINE";
    console.info("✅ DATABASE B@-IT BERHASIL DIMUAT");
    console.info("📁 File:", DB_FILE_NAME);
    console.info("📊 Total soal:", BANK.length);
    console.info("📍 Sumber:", window.__DB_SOURCE);

    if(typeof updateDatabaseInfo === "function") updateDatabaseInfo();
    return BANK;
  }catch(err){
    window.__BANK_READY = false;
    console.error("❌ DATABASE B@-IT GAGAL DIMUAT:", err);
    throw err;
  }
}


let state = {
  name:"", mode:"", questions:[], answers:[], flags:[], index:0, seconds:0, timer:null
};

/* ================= SIMPAN SESI UJIAN =================
   Saat refresh/reload, posisi, jawaban, tanda, dan waktu dipulihkan.
   Yang disimpan hanya ID soal + status pengerjaan, bukan isi soal.
   Isi soal tetap wajib dibaca kembali dari DATABASE EXCEL. */
const EXAM_SESSION_KEY = "SKD_IPDN_ACTIVE_EXAM_V1";
let cloudSaveTimer = null;
let cloudRestoreInProgress = false;

function getExamSessionPayload(){
  if(!state || !state.mode || !state.questions || !state.questions.length) return null;
  return {
    name:state.name,
    mode:state.mode,
    questionIds:state.questions.map(q=>String(q.id)),
    answers:state.answers,
    flags:state.flags,
    index:state.index,
    seconds:state.seconds,
    updatedAt:Date.now()
  };
}

function saveExamSession(){
  const payload=getExamSessionPayload();
  if(!payload) return;
  try{ localStorage.setItem(EXAM_SESSION_KEY, JSON.stringify(payload)); }catch(e){}

  // Cloud sync dibuat hemat: satu sesi per user+mode, ditulis dengan debounce.
  if(typeof window.saveCloudExamSession === "function") {
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer=setTimeout(()=>{
      const latest=getExamSessionPayload();
      if(latest) window.saveCloudExamSession(latest);
    }, 1200);
  }
}

async function saveExamSessionToCloudNow(){
  const payload=getExamSessionPayload();
  if(!payload || typeof window.saveCloudExamSession !== "function") return;
  clearTimeout(cloudSaveTimer);
  try{ await window.saveCloudExamSession(payload); }catch(e){}
}
window.saveExamSessionToCloudNow=saveExamSessionToCloudNow;

function updateResumeExamButton(show){
  const b=$("resumeExam");
  if(!b) return;
  b.classList.toggle("hidden", !show);
}

function clearExamSession(){
  updateResumeExamButton(false);
  try{ localStorage.removeItem(EXAM_SESSION_KEY); }catch(e){}
  clearTimeout(cloudSaveTimer);
  if(typeof window.clearCloudExamSession === "function" && window.__participantReady){
    window.clearCloudExamSession(state?.mode || null);
  }
}

let examBodyScrollY=0;
function setExamActive(active){
  if(active){
    examBodyScrollY=window.scrollY||0;
    document.body.classList.add("exam-active");
    document.documentElement.classList.add("exam-active");
  }else{
    document.body.classList.remove("exam-active");
    document.documentElement.classList.remove("exam-active");
    window.scrollTo(0,0);
  }
}

async function restoreExamSession(){
  if(cloudRestoreInProgress) return false;
  // Hindari dua interval timer ketika peserta logout lalu login kembali.
  if(state?.timer){ clearInterval(state.timer); state.timer=null; }
  cloudRestoreInProgress=true;
  let saved=null;
  try{ saved=JSON.parse(localStorage.getItem(EXAM_SESSION_KEY)||"null"); }catch(e){ saved=null; }

  // Firebase menjadi sumber utama agar user yang sama dapat melanjutkan dari browser lain.
  try{
    if(typeof window.loadCloudExamSession === "function") {
      const cloudSaved=await window.loadCloudExamSession();
      if(cloudSaved && cloudSaved.mode && Array.isArray(cloudSaved.questionIds) && cloudSaved.questionIds.length){
        if(!saved || Number(cloudSaved.updatedAt||0) >= Number(saved.updatedAt||0)) {
          saved=cloudSaved;
          try{ localStorage.setItem(EXAM_SESSION_KEY, JSON.stringify(saved)); }catch(e){}
        }
      }
    }
  }catch(e){ console.warn("Cloud session restore gagal:",e); }
  cloudRestoreInProgress=false;

  if(!saved || !saved.mode || !Array.isArray(saved.questionIds) || !saved.questionIds.length) return false;

  // Pengamanan: sesi lama hanya boleh dipulihkan jika level tersebut sedang terbuka.
  if(typeof isModeUnlocked === "function" && !isModeUnlocked(String(saved.mode))){
    clearExamSession();
    return false;
  }

  try{
    if(!window.__BANK_READY) await loadBankFromExcel();
    const byId=new Map(BANK.map(q=>[String(q.id),q]));
    const questions=saved.questionIds.map(id=>byId.get(String(id))).filter(Boolean);

    if(questions.length!==saved.questionIds.length){
      clearExamSession();
      appNotify("Database berubah atau beberapa soal dari sesi sebelumnya tidak ditemukan. Sesi lama dibatalkan agar tidak terjadi ketidaksesuaian soal.","SESI LAMA TIDAK DAPAT DIPULIHKAN","⚠️");
      return false;
    }

    state={
      name:String(saved.name||""),
      mode:String(saved.mode),
      questions,
      answers:Array.isArray(saved.answers)&&saved.answers.length===questions.length ? saved.answers : Array(questions.length).fill(null),
      flags:Array.isArray(saved.flags)&&saved.flags.length===questions.length ? saved.flags : Array(questions.length).fill(false),
      index:Math.min(Math.max(Number(saved.index)||0,0),questions.length-1),
      // Waktu tetap berjalan walaupun peserta logout/beristirahat.
      // Saat sesi dipulihkan, kurangi waktu yang telah berlalu sejak penyimpanan terakhir.
      seconds:Math.max(0,(Number(saved.seconds)||0) - Math.max(0,Math.floor((Date.now()-Number(saved.updatedAt||Date.now()))/1000))),
      timer:null
    };

    $("home").classList.add("hidden");
    $("result").classList.add("hidden");
    document.body.classList.remove("result-active");
    $("exam").classList.remove("hidden");
    $("examName").textContent=state.name;
    $("examTitle").textContent=modeLabel(state.mode);
    setExamActive(true);

    if(state.seconds>0){
      $("timer").classList.remove("hidden");
      tick();
      state.timer=setInterval(tick,1000);
    }else{
      $("timer").classList.add("hidden");
    }
    updateResumeExamButton(false);
    render();
    return true;
  }catch(e){
    console.error("Gagal memulihkan sesi:",e);
    if(location.protocol==="file:"){
      appNotify("Sesi ujian Anda masih tersimpan. Aplikasi ini tidak dapat membuka kembali file lokal secara otomatis. Silakan pilih DATABASE LOKAL B@-IT sekali lagi; setelah database terbaca, sesi dan jawaban akan dilanjutkan.","SESI UJIAN TERSIMPAN","💾");
    }
    return false;
  }
}

const $ = id => document.getElementById(id);
const shuffle = a => [...a].sort(()=>Math.random()-0.5);

/* ================= PESAN APLIKASI ================= */
const appModal=$("appModal"), appDialogTitle=$("appDialogTitle"), appDialogMessage=$("appDialogMessage"), appDialogIcon=$("appDialogIcon"), appDialogOk=$("appDialogOk"), appDialogCancel=$("appDialogCancel");
let appDialogCallback=null, appDialogCancelCallback=null;
function closeAppModal(){
  if(!appModal) return;
  appModal.classList.add("hidden");
  appModal.setAttribute("aria-hidden","true");
  appDialogCallback=null; appDialogCancelCallback=null;
}
function appNotify(message,title="INFORMASI APLIKASI",icon="ℹ️",callback=null){
  appDialogTitle.textContent=title; appDialogMessage.textContent=message; appDialogIcon.textContent=icon;
  appDialogCancel.classList.add("hidden"); appDialogOk.textContent="OK";
  appDialogCallback=callback; appDialogCancelCallback=null;
  appModal.classList.remove("hidden"); appModal.setAttribute("aria-hidden","false");
}
function appConfirm(message,title="KONFIRMASI",icon="❓",onYes=null){
  appDialogTitle.textContent=title; appDialogMessage.textContent=message; appDialogIcon.textContent=icon;
  appDialogCancel.classList.remove("hidden"); appDialogOk.textContent="YA, LANJUTKAN";
  appDialogCallback=onYes; appDialogCancelCallback=null;
  appModal.classList.remove("hidden"); appModal.setAttribute("aria-hidden","false");
}
appDialogOk.addEventListener("click",()=>{const cb=appDialogCallback;closeAppModal();if(cb)cb();});
appDialogCancel.addEventListener("click",closeAppModal);
appModal.addEventListener("click",e=>{if(e.target===appModal)closeAppModal();});
document.addEventListener("keydown",e=>{if(e.key==="Escape" && !appModal.classList.contains("hidden"))closeAppModal();});


/* ================= ISTIRAHAT / KEMBALI KE MENU =================
   Tombol ini TIDAK menghapus sesi ujian. Soal, jawaban, posisi, dan waktu
   tetap tersimpan. Timer terus berjalan di latar belakang.
*/
function goToMainMenuForBreak(){
  if(!state || !state.mode || !state.questions?.length) return;
  saveExamSession();
  saveExamSessionToCloudNow();
  if(state.timer) clearInterval(state.timer);
  state.timer=null;
  // Timer tetap berjalan secara logis melalui updatedAt. Saat masuk kembali,
  // restoreExamSession akan menghitung waktu yang telah berlalu.
  setExamActive(false);
  $("exam")?.classList.add("hidden");
  $("result")?.classList.add("hidden");
  document.body.classList.remove("result-active");
  $("home")?.classList.remove("hidden");
  updateResumeExamButton(true);
  updateModeCards();
  window.scrollTo(0,0);
}

$("examBreak")?.addEventListener("click",()=>{
  appConfirm(
    "Apakah Anda ingin ISTIRAHAT sementara?\n\n"
    +"Anda akan kembali ke halaman utama/menu latihan.\n"
    +"Posisi soal dan semua jawaban tetap tersimpan. Waktu pengerjaan TETAP BERJALAN.\n\n"
    +"Tekan OK untuk kembali ke menu utama atau BATAL untuk tetap mengerjakan soal.",
    "ISTIRAHAT SEMENTARA",
    "⏸️",
    goToMainMenuForBreak
  );
});

/* ================= AUDIO UJIAN =================
   Semua suara dibuat langsung oleh browser, tanpa file audio eksternal.
   70% adalah ambang SIMULASI aplikasi, bukan ketentuan resmi BKN/IPDN.
*/
/* ================= LEVEL BERURUTAN / WAJIB 100% =================
   Level berikutnya baru terbuka jika level sebelumnya mendapat
   100% benar. Progress disimpan di browser agar tidak hilang saat
   kembali ke menu atau refresh.
*/
const GATE_KEY = "SKD_IPDN_LEVEL_GATE_V1";
const GATE_MODES = ["practice","simulation","cat","real"];

function getGate(){
  try{
    const saved=JSON.parse(localStorage.getItem(GATE_KEY)||"null");
    if(saved && typeof saved==="object") return {
      practice:saved.practice===true,
      simulation:saved.simulation===true,
      cat:saved.cat===true,
      real:saved.real===true
    };
  }catch(e){}
  return {practice:false,simulation:false,cat:false,real:false};
}

function saveGate(gate){
  try{ localStorage.setItem(GATE_KEY,JSON.stringify(gate)); }catch(e){}
}

function isModeUnlocked(mode){
  const gate=getGate();
  const index=GATE_MODES.indexOf(mode);
  if(index<=0) return true;
  return gate[GATE_MODES[index-1]]===true;
}

function unlockMode(mode){
  if(!GATE_MODES.includes(mode)) return;
  const gate=getGate();
  gate[mode]=true;
  saveGate(gate);
  updateModeCards();
}

function resetFollowingModes(mode){
  const index=GATE_MODES.indexOf(mode);
  if(index<0) return;
  const gate=getGate();
  for(let i=index;i<GATE_MODES.length;i++) gate[GATE_MODES[i]]=false;
  saveGate(gate);
  updateModeCards();
}

function updateModeCards(){
  document.querySelectorAll(".mode .start").forEach(btn=>{
    const mode=btn.dataset.mode;
    const card=btn.closest(".mode");
    const lock=card?.querySelector(".mode-lock");
    const unlocked=isModeUnlocked(mode);
    btn.disabled=!unlocked;
    card?.classList.toggle("locked",!unlocked);
    card?.classList.toggle("unlocked",unlocked);
    if(lock){
      if(mode==="practice"){
        lock.textContent="🔓 TERSEDIA";
      }else if(unlocked){
        lock.textContent="🔓 TERBUKA — SILAKAN MULAI";
      }else{
        const index=GATE_MODES.indexOf(mode);
        const previous=GATE_MODES[Math.max(0,index-1)];
        lock.textContent="🔒 SELESAIKAN "+modeLabel(previous)+" 100%";
      }
    }
  });
}

const MASTER_PASS_PERCENT = 100;

const PASS_PERCENT = 70;
let soundEnabled = true;
let audioCtx = null;

function ensureAudio(){
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === "suspended") audioCtx.resume();
  }catch(e){}
}

function tone(freq, duration=.18, type="sine", volume=.06, delay=0){
  if(!soundEnabled) return;
  ensureAudio();
  if(!audioCtx) return;
  const t=audioCtx.currentTime+delay;
  const o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.type=type;
  o.frequency.setValueAtTime(freq,t);
  g.gain.setValueAtTime(0.0001,t);
  g.gain.exponentialRampToValueAtTime(Math.max(volume,.001),t+.02);
  g.gain.exponentialRampToValueAtTime(.0001,t+duration);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(t); o.stop(t+duration+.03);
}

function speak(text){
  if(!soundEnabled || !("speechSynthesis" in window)) return;
  try{
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    u.lang="id-ID";
    u.rate=.92;
    u.pitch=1;
    u.volume=1;
    speechSynthesis.speak(u);
  }catch(e){}
}

function soundWarning(minutes){
  tone(880,.16,"sine",.08,0);
  tone(660,.16,"sine",.08,.22);
  speak("Perhatian. Waktu ujian tersisa "+minutes+" menit.");
}

function soundTimeUp(){
  tone(880,.18,"sine",.09,0);
  tone(660,.18,"sine",.09,.22);
  tone(440,.45,"sine",.10,.45);
  speak("Waktu ujian telah selesai. Jawaban akan dikumpulkan.");
}

function soundSad(){
  tone(392,.35,"sine",.08,0);
  tone(330,.45,"sine",.08,.38);
  tone(262,.65,"sine",.08,.86);
  speak("Hasil ujian belum mencapai ambang simulasi. Tetap semangat dan terus berlatih.");
}

function soundHappy(){
  tone(523,.18,"sine",.07,0);
  tone(659,.18,"sine",.07,.20);
  tone(784,.22,"sine",.07,.40);
  tone(1047,.35,"sine",.08,.65);
  speak("Selamat! Nilai Anda mencapai ambang simulasi.");
  // Efek tepuk tangan sintetis sederhana.
  for(let i=0;i<12;i++){
    const d=.95+i*.12;
    tone(110+Math.random()*120,.07,"triangle",.035,d);
    tone(180+Math.random()*180,.05,"triangle",.025,d+.055);
  }
}

function soundResult(pct){
  if(pct>=PASS_PERCENT) soundHappy();
  else soundSad();
}

function makeExam(mode, participantName=""){
  // PEMBAGIAN LEVEL MUTLAK:
  // LATIHAN = MUDAH | SIMULASI = SEDANG
  // SIMULASI CAT = SULIT | UJIAN NYATA = SUPER SULIT
  // TIDAK ADA PINDAH LEVEL / PINDAH KATEGORI.
  //
  // SISTEM RANDOM BER-SIKLUS:
  // Setiap peserta/browser mempunyai antrean acak sendiri.
  // Soal yang sudah keluar tidak diambil lagi sampai stok kategori
  // pada siklus tersebut habis. Setelah stok habis, sistem otomatis
  // membuat siklus baru dan mengacak ulang dari awal.
  // Jadi pemakaian banyak orang tidak membuat database habis.

  const levelByMode = {
    practice:"Mudah",
    simulation:"Sedang",
    cat:"Sulit",
    real:"Super Sulit"
  };

  const needByMode = {
    practice:{TWK:7, TIU:7, TKP:6},
    simulation:{TWK:30, TIU:35, TKP:45},
    cat:{TWK:30, TIU:35, TKP:45},
    real:{TWK:30, TIU:35, TKP:45}
  };

  if(!levelByMode[mode]) throw new Error("MODE TIDAK DIKENAL: "+mode);

  const level = levelByMode[mode];
  const need = needByMode[mode];
  const categories = ["TWK","TIU","TKP"];
  const expected = mode==="practice" ? 20 : 110;

  const normLevel = v => String(v ?? "").trim().toLowerCase();
  const normCat = v => String(v ?? "").trim().toUpperCase();
  const qKey = item => normalizeQuestion(cleanQuestionDisplay(item.q));

  const randomize = arr => {
    const a=[...arr];
    for(let i=a.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  };

  const unique = items => {
    const seen=new Set(), out=[];
    for(const item of items){
      const k=qKey(item);
      if(k && !seen.has(k)){
        seen.add(k);
        out.push(item);
      }
    }
    return out;
  };

  // Nama peserta ikut menjadi bagian dari kunci antrean.
  // Dengan demikian beberapa peserta pada komputer/browser yang sama
  // tidak saling menghabiskan antrean random masing-masing.
  const safeName = String(participantName||"").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g,"_").slice(0,80) || "peserta";

  const result=[];
  const selected=new Set();

  for(const cat of categories){
    const pool=unique(BANK.filter(x =>
      normCat(x.cat)===cat &&
      normLevel(x.level)===normLevel(level)
    ));

    if(pool.length < need[cat]){
      throw new Error(
        "BANK SOAL TIDAK CUKUP: "+cat+" / "+level+
        " hanya "+pool.length+" soal, perlu "+need[cat]
      );
    }

    const poolMap=new Map(pool.map(item=>[qKey(item),item]));
    const queueKey="SKD_IPDN_RANDOM_CYCLE_V2|"+safeName+"|"+mode+"|"+normLevel(level)+"|"+cat;
    let remaining=[];

    try{
      const saved=JSON.parse(localStorage.getItem(queueKey)||"[]");
      if(Array.isArray(saved)){
        remaining=saved.filter(k=>poolMap.has(k));
      }
    }catch(e){
      remaining=[];
    }

    // Jika stok acak untuk kategori ini sudah habis / tidak cukup
    // untuk satu paket, OTOMATIS buat siklus baru dan acak ulang.
    if(remaining.length < need[cat]){
      remaining=randomize(pool.map(item=>qKey(item)));
    }

    const take=[];
    for(const keyQ of remaining){
      if(take.length>=need[cat]) break;
      if(selected.has(keyQ)) continue;
      take.push(keyQ);
      selected.add(keyQ);
    }

    // Pengaman tambahan. Secara normal tidak akan terjadi karena pool
    // sudah divalidasi cukup dan kategori tetap dipisahkan.
    if(take.length!==need[cat]){
      throw new Error("GAGAL MEMBENTUK PAKET: "+cat+" / "+level);
    }

    const nextRemaining=remaining.filter(k=>!take.includes(k));

    try{
      localStorage.setItem(queueKey,JSON.stringify(nextRemaining));
    }catch(e){}

    for(const keyQ of take){
      const item=poolMap.get(keyQ);
      if(item){
        if(normCat(item.cat)!==cat || normLevel(item.level)!==normLevel(level)){
          throw new Error("SOAL MELANGGAR PEMISAHAN LEVEL/KATEGORI.");
        }
        result.push(item);
      }
    }
  }

  if(result.length!==expected){
    throw new Error("PAKET TIDAK LENGKAP: "+result.length+" / "+expected);
  }

  return randomize(result);
}
function modeLabel(mode){
  return mode==="practice" ? "LATIHAN" :
         mode==="simulation" ? "SIMULASI" :
         mode==="cat" ? "SIMULASI CAT" : "UJIAN NYATA";
}

async function start(mode){
  // Jika peserta sebelumnya menekan ISTIRAHAT, sesi tetap berada di memori
  // dan tersimpan di cloud. Saat menu latihan yang sama dipilih lagi, jangan
  // memulai sesi baru dan jangan menampilkan pesan yang membingungkan.
  // Tawarkan untuk melanjutkan sesi yang ada.
  if(state?.mode && state?.questions?.length){
    if(String(state.mode)===String(mode)){
      appDialogTitle.textContent="LANJUTKAN LATIHAN?";
      appDialogMessage.textContent=
        "Masih ada latihan "+modeLabel(state.mode)+" yang tersimpan.\n\n"
        +"Apakah Anda ingin melanjutkan dari posisi soal terakhir?\n"
        +"Jawaban dan waktu tetap berjalan.";
      appDialogIcon.textContent="▶️";
      appDialogCancel.classList.remove("hidden");
      appDialogCancel.textContent="BATAL";
      appDialogOk.textContent="OK";
      appDialogCallback=async ()=>{ await restoreExamSession(); };
      appDialogCancelCallback=null;
      appModal.classList.remove("hidden");
      appModal.setAttribute("aria-hidden","false");
      return;
    }
    appNotify(
      "Masih ada sesi "+modeLabel(state.mode)+" yang sedang berjalan.\n\n"
      +"Silakan pilih "+modeLabel(state.mode)+" untuk melanjutkan latihan yang tersimpan.",
      "SESI UJIAN MASIH BERJALAN",
      "⏱️"
    );
    return;
  }
  if(!isModeUnlocked(mode)){
    const index=GATE_MODES.indexOf(mode);
    const previous=GATE_MODES[Math.max(0,index-1)];
    appNotify(
      "Mode ini masih terkunci. Anda harus menyelesaikan "+modeLabel(previous)+" terlebih dahulu dengan nilai tepat 100%. Jika nilainya di bawah 100%, ulangi "+modeLabel(previous)+" sampai semua jawaban benar.",
      "LEVEL MASIH TERKUNCI",
      "🔒"
    );
    return;
  }

  if(!window.__BANK_READY){
    try{
      await loadBankFromExcel();
    }catch(e){
      const local = document.getElementById("localExcelInput");
      appNotify("Aplikasi belum bisa memulai ujian karena database B@-it belum tersedia.\n\nJika online: pastikan Database_SIMULASI_SKD_IPDN_CPNS B@-it berada satu folder dengan Aplikasi.\nJika lokal: buka Power By Wak Dit B@-it | @2026 → LOGIN → PILIH DATABASE LOKAL B@-IT.", "DATABASE BELUM TERSEDIA", "⚠️");
      // Jangan membuka file picker otomatis dari tombol LATIHAN/SIMULASI/UJIAN.
      // Database lokal hanya dipilih melalui tombol khusus di panel informasi.
      return;
    }
  }

  const participant = window.__participantProfile;
  const name = participant?.name?.trim() || "";
  if(!window.__participantReady || !name){
    appNotify("Silakan daftar dan login sebagai peserta terlebih dahulu.", "AKUN PESERTA", "👤");
    return;
  }

  let qs;
  try{
    await loadBankFromExcel();
    qs = makeExam(mode, name);
  }catch(e){
    return;
  }
  if(qs.length < (mode==="practice" ? 20 : 110)){
    appNotify("Bank soal belum mencukupi untuk mode ini.", "DATABASE SOAL", "📚");
    return;
  }

  state = {
    name, mode, questions:qs, answers:Array(qs.length).fill(null),
    flags:Array(qs.length).fill(false), index:0,
    seconds: mode==="practice" ? 0 : 100*60, timer:null
  };

  $("home").classList.add("hidden");
  $("result").classList.add("hidden");
  $("exam").classList.remove("hidden");
  setExamActive(true);
  updateResumeExamButton(false);
  $("examName").textContent = name;
  $("examTitle").textContent = modeLabel(mode);

  if(state.seconds){
    $("timer").classList.remove("hidden");
    tick();
    state.timer=setInterval(tick,1000);
  }else{
    $("timer").classList.add("hidden");
  }
  render();
  saveExamSession();
}

function tick(){
  const s=state.seconds;
  $("timer").textContent =
    String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");

  if(state.mode!=="practice"){
    if(s===10*60) soundWarning(10);
    if(s===5*60) soundWarning(5);
    if(s===60) soundWarning(1);
  }

  saveExamSession();

  if(s<=0){
    clearInterval(state.timer);
    state.timer=null;
    state.seconds=0;
    saveExamSession();

    if(state.mode!=="practice"){
      soundTimeUp();

      /* Waktu habis: jangan langsung menampilkan hasil.
         Tampilkan informasi aplikasi terlebih dahulu.
         Setelah peserta menekan OK, barulah masuk ke nilai. */
      appNotify(
        "⏰ WAKTU PENGERJAAN TELAH HABIS.\n\n"
        +"Sesi ujian otomatis ditutup dan seluruh jawaban yang sudah tersimpan akan dinilai.\n\n"
        +"Klik OK untuk melihat hasil ujian.",
        "WAKTU HABIS",
        "⏰",
        ()=>finish(true, "timeup")
      );
    }
    return;
  }

  state.seconds--;
  saveExamSession();
}
function render(){
  const q=state.questions[state.index];
  $("qNo").textContent = "SOAL "+(state.index+1)+" / "+state.questions.length;
  $("qCat").textContent = q.cat;
  $("qText").textContent = cleanQuestionDisplay(q.q);

  $("options").innerHTML = q.opts.map((op,i)=>{
    const checked=state.answers[state.index]===i ? "checked" : "";
    const sel=checked ? " selected" : "";
    return `<label class="opt${sel}">
      <input type="radio" name="opt" value="${i}" ${checked}>
      <b>${String.fromCharCode(65+i)}.</b> ${escapeHtml(op)}
    </label>`;
  }).join("");

  document.querySelectorAll('input[name="opt"]').forEach(r=>{
    r.addEventListener("change",()=>{
      state.answers[state.index]=Number(r.value);
      saveExamSession();
      render();
    });
  });

  $("prev").disabled=state.index===0;
  $("next").textContent=state.index===state.questions.length-1?"SOAL TERAKHIR →":"SELANJUTNYA →";
  $("flag").textContent=state.flags[state.index]?"⚑ HAPUS TANDA":"⚑ TANDAI";
  renderNumbers();
}

function renderNumbers(){
  $("numbers").innerHTML=state.questions.map((_,i)=>{
    const c=[
      "num",
      state.answers[i]!==null?"answered":"",
      state.flags[i]?"flag":"",
      i===state.index?"current":""
    ].filter(Boolean).join(" ");
    return `<button class="${c}" data-i="${i}">${i+1}</button>`;
  }).join("");
  document.querySelectorAll(".num").forEach(b=>{
    b.onclick=()=>{state.index=Number(b.dataset.i);saveExamSession();render();}
  });
}

function getUnansweredIndexes(){
  return state.questions
    .map((_,i)=>state.answers[i]===null ? i : -1)
    .filter(i=>i>=0);
}

function showUnansweredWarning(){
  const unanswered=getUnansweredIndexes();
  if(!unanswered.length) return false;

  const first=unanswered[0];
  state.index=first;
  saveExamSession();
  render();

  appNotify(
    "⚠️ MASIH ADA SOAL YANG BELUM DIJAWAB.\n\n"
    +"Masih ada "+unanswered.length+" soal yang belum dikerjakan. "
    +"Sistem belum mengizinkan sesi diakhiri selama waktu masih tersedia.\n\n"
    +"Silakan selesaikan soal yang ditampilkan. "
    +"Soal yang sudah ditandai tetap harus diselesaikan sebelum ujian dapat dikumpulkan.",
    "BELUM DAPAT DIKUMPULKAN",
    "⚠️"
  );
  return true;
}

function finish(auto=false, reason="manual"){
  if(state.timer) clearInterval(state.timer);
  state.timer=null;
  clearExamSession();
  setExamActive(false);

  let correct=0, answered=0;
  const cats={TWK:{c:0,a:0},TIU:{c:0,a:0},TKP:{c:0,a:0}};
  state.questions.forEach((q,i)=>{
    const a=state.answers[i];
    if(a!==null) answered++;
    if(cats[q.cat]) cats[q.cat].a++;
    if(a!==null && a===q.ans){
      correct++;
      if(cats[q.cat]) cats[q.cat].c++;
    }
  });

  const pct=Math.round(correct/state.questions.length*100);
  const passed100 = correct===state.questions.length && pct===MASTER_PASS_PERCENT;
  const finishedMode=state.mode;

  // Hanya nilai 100% yang membuka level berikutnya.
  if(passed100){
    unlockMode(finishedMode);
  }else{
    // Level yang gagal tetap harus diulang; level sesudahnya tidak boleh terbuka.
    resetFollowingModes(finishedMode);
  }

  $("exam").classList.add("hidden");
  $("result").classList.remove("hidden");
  document.body.classList.add("result-active");

  $("resultTitle").textContent = auto ? "WAKTU HABIS — HASIL UJIAN" : "HASIL "+modeLabel(state.mode);
  $("resultSub").textContent = "Peserta: "+state.name;

  $("scores").innerHTML = [
    ["TWK",cats.TWK.c+"/"+cats.TWK.a],
    ["TIU",cats.TIU.c+"/"+cats.TIU.a],
    ["TKP",cats.TKP.c+"/"+cats.TKP.a]
  ].map(x=>`<div class="score"><span>${x[0]}</span><b>${x[1]}</b><small>jawaban benar</small></div>`).join("");

  $("summary").innerHTML =
    `<b>Ringkasan:</b> ${correct} benar dari ${state.questions.length} soal
    (${pct}%). Terjawab ${answered} soal, tidak terjawab ${state.questions.length-answered} soal.`;

  const nextIndex=GATE_MODES.indexOf(finishedMode)+1;
  const nextMode=GATE_MODES[nextIndex];
  let gateMessage="";
  if(passed100){
    gateMessage = nextMode
      ? `<div class="result-gate pass">✅ LULUS 100%!<br>${modeLabel(nextMode)} sekarang sudah TERBUKA.</div>`
      : `<div class="result-gate pass">🏆 SELAMAT! SEMUA LEVEL SUDAH DISELESAIKAN DENGAN 100%.</div>`;
  }else{
    gateMessage = `<div class="result-gate fail">❌ BELUM LULUS.<br>Nilai wajib <b>100%</b>. Silakan ulangi ${modeLabel(finishedMode)} sampai semua soal benar.</div>`;
  }
  $("summary").innerHTML += gateMessage;

  $("review").innerHTML=state.questions.map((q,i)=>{
    const a=state.answers[i];
    const ok=a===q.ans;
    const user=a===null?"Tidak dijawab":String.fromCharCode(65+a)+". "+escapeHtml(q.opts[a]);
    const right=String.fromCharCode(65+q.ans)+". "+escapeHtml(q.opts[q.ans]);
    return `<div class="review-item ${ok?"ok":"bad"}">
      <b>${i+1}. ${escapeHtml(cleanQuestionDisplay(q.q))}</b>
      <div>Jawaban Anda: ${user}</div>
      <div>Jawaban benar: ${right}</div>
      <div class="exp"><b>Pembahasan:</b> ${escapeHtml(q.exp||"Pembahasan belum tersedia.")}</div>
    </div>`;
  }).join("");

  window.scrollTo(0,0);

  if(auto && reason==="timeup"){
    setTimeout(()=>soundResult(pct),900);
  }else{
    soundResult(pct);
  }
}

function escapeHtml(v){
  return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}

const soundButton=$("soundToggle");
if(soundButton){
  soundButton.onclick=()=>{
    soundEnabled=!soundEnabled;
    soundButton.textContent=soundEnabled?"🔊":"🔇";
    if(soundEnabled) ensureAudio();
    else if("speechSynthesis" in window) speechSynthesis.cancel();
  };
}

$("prev").onclick=()=>{
  if(state.index>0){
    state.index--;
    saveExamSession();
    render();
  }
};

$("next").onclick=()=>{
  const unanswered = state.answers[state.index] === null;
  const marked = state.flags[state.index] === true;

  // Soal yang belum dijawab tidak boleh dilewati tanpa ditandai.
  if(unanswered && !marked){
    appNotify(
      "SOAL INI BELUM DIJAWAB.\n\n"
      +"Silakan pilih salah satu jawaban terlebih dahulu. "
      +"Jika memang ingin melewatinya sementara, tekan TANDAI terlebih dahulu.",
      "SOAL BELUM DIJAWAB",
      "⚑"
    );
    return;
  }

  if(state.index<state.questions.length-1){
    state.index++;
    saveExamSession();
    render();
  }else{
    /* Sampai di soal terakhir tidak otomatis berarti boleh selesai.
       Semua soal wajib sudah memiliki jawaban. */
    if(showUnansweredWarning()) return;

    appConfirm(
      "Semua soal sudah dijawab. Yakin ingin mengumpulkan ujian sekarang?",
      "SIAP DIKUMPULKAN",
      "📋",
      ()=>finish(false)
    );
  }
};

$("flag").onclick=()=>{
  state.flags[state.index]=!state.flags[state.index];
  saveExamSession();
  render();
};

$("finish").onclick=()=>{
  /* Selama waktu masih ada, tombol SELESAI tidak boleh
     mengakhiri sesi jika masih ada jawaban kosong. */
  if(showUnansweredWarning()) return;

  appConfirm(
    "Semua soal sudah dijawab. Yakin ingin mengumpulkan ujian sekarang?",
    "KONFIRMASI KUMPULKAN",
    "📋",
    ()=>finish(false)
  );
};

$("back").onclick=()=>{
  clearExamSession();
  setExamActive(false);
  document.body.classList.remove("result-active");
  $("result").classList.add("hidden");
  $("home").classList.remove("hidden");
  updateModeCards();
  window.scrollTo(0,0);
};

/* ================= INFO PEMBUAT + DATABASE ================= */
function fmtNumber(n){ return Number(n||0).toLocaleString("id-ID"); }
function updateDatabaseInfo(){
  const cats={
    TWK:{easy:0,medium:0,hard:0,superhard:0,total:0},
    TIU:{easy:0,medium:0,hard:0,superhard:0,total:0},
    TKP:{easy:0,medium:0,hard:0,superhard:0,total:0}
  };
  const levels={Mudah:0,Sedang:0,Sulit:0,"Super Sulit":0};

  BANK.forEach(q=>{
    const c=cats[q.cat];
    if(!c) return;

    c.total++;
    const lv=String(q.level||"").trim().toLowerCase();

    if(lv==="mudah"){
      c.easy++;
      levels.Mudah++;
    }else if(lv==="sedang"){
      c.medium++;
      levels.Sedang++;
    }else if(lv==="sulit"){
      c.hard++;
      levels.Sulit++;
    }else if(lv==="super sulit" || lv==="super_sulit" || lv==="supersulit"){
      c.superhard++;
      levels["Super Sulit"]++;
    }
  });

  $("dbFile").textContent="Database_SIMULASI_SKD_IPDN_CPNS";
  $("dbTotal").textContent=fmtNumber(BANK.length)+" SOAL";
  $("dbTWK").textContent=fmtNumber(cats.TWK.total);
  $("dbTIU").textContent=fmtNumber(cats.TIU.total);
  $("dbTKP").textContent=fmtNumber(cats.TKP.total);
  $("dbEasy").textContent=fmtNumber(levels.Mudah);
  $("dbMedium").textContent=fmtNumber(levels.Sedang);
  $("dbHard").textContent=fmtNumber(levels.Sulit);
  $("dbSuperHard").textContent=fmtNumber(levels["Super Sulit"]);

  $("dbDetail").innerHTML=["TWK","TIU","TKP"].map(c=>{
    const x=cats[c];
    return `<tr>
      <td>${c}</td>
      <td>${fmtNumber(x.easy)}</td>
      <td>${fmtNumber(x.medium)}</td>
      <td>${fmtNumber(x.hard)}</td>
      <td>${fmtNumber(x.superhard)}</td>
      <td>${fmtNumber(x.total)}</td>
    </tr>`;
  }).join("")+
  `<tr class="total-row">
    <td>TOTAL</td>
    <td>${fmtNumber(levels.Mudah)}</td>
    <td>${fmtNumber(levels.Sedang)}</td>
    <td>${fmtNumber(levels.Sulit)}</td>
    <td>${fmtNumber(levels["Super Sulit"])}</td>
    <td>${fmtNumber(BANK.length)}</td>
  </tr>`;
}
async function openInfoModal(){
  $("infoModal").classList.remove("hidden");
  $("infoModal").setAttribute("aria-hidden","false");
  const status=$("dbStatus");
  status.className="db-status loading";
  status.textContent="⏳ MEMBACA DATABASE...";
  try{
    await loadBankFromExcel();
    updateDatabaseInfo();
    status.className="db-status";
    status.textContent="🟢 DATABASE TERHUBUNG";
  }catch(e){
    $("dbFile").textContent="Database_SIMULASI_SKD_IPDN_CPNS";
    $("dbTotal").textContent="GAGAL";
    $("dbDetail").innerHTML=`<tr><td colspan="6">Database belum berhasil dibaca. Periksa lokasi dan nama file B@-it.</td></tr>`;
    status.className="db-status error";
    status.textContent="🔴 DATABASE GAGAL DIMUAT";
  }
}
function closeInfoModal(){
  $("infoModal").classList.add("hidden");
  $("infoModal").setAttribute("aria-hidden","true");
}
$("powerFooter").addEventListener("click",openInfoModal);
$("infoClose").addEventListener("click",closeInfoModal);
$("infoModal").addEventListener("click",e=>{if(e.target===$("infoModal")) closeInfoModal();});
document.addEventListener("keydown",e=>{if(e.key==="Escape" && !$("infoModal").classList.contains("hidden")) closeInfoModal();});

/* ================= PERSIST DATABASE LOKAL =================
   Hanya menyimpan HANDLE file, bukan isi Excel/soal.
   Jika browser mendukung File System Access API, sesi dapat
   membuka kembali file Excel yang sama setelah refresh.
*/
const DB_HANDLE_STORE="SKD_IPDN_DB_HANDLE_V1";
async function saveLocalDbHandle(handle){
  if(!handle || !window.indexedDB) return;
  try{
    const db=await new Promise((resolve,reject)=>{
      const r=indexedDB.open(DB_HANDLE_STORE,1);
      r.onupgradeneeded=()=>r.result.createObjectStore("handles");
      r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
    });
    await new Promise((resolve,reject)=>{
      const tx=db.transaction("handles","readwrite");
      tx.objectStore("handles").put(handle,"excel");
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
    });
    db.close();
  }catch(e){}
}
async function getLocalDbHandle(){
  if(!window.indexedDB) return null;
  try{
    const db=await new Promise((resolve,reject)=>{
      const r=indexedDB.open(DB_HANDLE_STORE,1);
      r.onupgradeneeded=()=>r.result.createObjectStore("handles");
      r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
    });
    const h=await new Promise((resolve,reject)=>{
      const tx=db.transaction("handles","readonly");
      const r=tx.objectStore("handles").get("excel");
      r.onsuccess=()=>resolve(r.result||null); r.onerror=()=>reject(r.error);
    });
    db.close(); return h;
  }catch(e){ return null; }
}
async function restoreLocalDatabase(){
  if(location.protocol!=="file:") return false;
  const h=await getLocalDbHandle();
  if(!h || !h.getFile) return false;
  try{
    if(h.queryPermission){
      let p=await h.queryPermission({mode:"read"});
      if(p!=="granted" && h.requestPermission){
        p=await h.requestPermission({mode:"read"});
      }
      if(p!=="granted") return false;
    }
    const f=await h.getFile();
    BANK=[]; window.__BANK_READY=false;
    await loadBankFromExcel(f);
    updateDatabaseInfo();
    return true;
  }catch(e){ return false; }
}

(function(){
  const input = document.getElementById("localExcelInput");
  const btn = document.getElementById("chooseLocalExcel");
  const loginModal = document.getElementById("loginModal");
  const loginForm = document.getElementById("loginForm");
  const loginUser = document.getElementById("loginUser");
  const loginPass = document.getElementById("loginPass");
  const loginError = document.getElementById("loginError");
  const loginClose = document.getElementById("loginClose");
  const loginCancel = document.getElementById("loginCancel");
  if(!input || !btn || !loginModal || !loginForm) return;

  /* KREDENSIAL LOGIN DATABASE LOKAL — tidak mengubah database/soal */
  const LOCAL_DB_USERNAME = "admin";
  const LOCAL_DB_PASSWORD = "12345";

  function openLogin(){
    loginModal.classList.remove("hidden");
    loginModal.setAttribute("aria-hidden","false");
    loginError.textContent="";
    loginUser.value="";
    loginPass.value="";
    setTimeout(()=>loginUser.focus(),80);
  }
  function closeLogin(){
    loginModal.classList.add("hidden");
    loginModal.setAttribute("aria-hidden","true");
    loginError.textContent="";
  }

  btn.addEventListener("click",openLogin);
  loginClose.addEventListener("click",closeLogin);
  loginCancel.addEventListener("click",closeLogin);
  loginModal.addEventListener("click",e=>{if(e.target===loginModal) closeLogin();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape" && !loginModal.classList.contains("hidden")) closeLogin();});

  loginForm.addEventListener("submit",async e=>{
    e.preventDefault();
    const u=loginUser.value.trim();
    const p=loginPass.value;
    if(!u || !p){
      loginError.textContent="❌ USER dan PASSWORD wajib diisi.";
      return;
    }
    if(u===LOCAL_DB_USERNAME && p===LOCAL_DB_PASSWORD){
      closeLogin();
      if(window.showOpenFilePicker){
        try{
          const [handle]=await window.showOpenFilePicker({
            multiple:false,
            types:[{description:"Database Excel",accept:{"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":[".xlsx"],"application/vnd.ms-excel":[".xls"]}}]
          });
          await saveLocalDbHandle(handle);
          const file=await handle.getFile();
          BANK=[]; window.__BANK_READY=false;
          await loadBankFromExcel(file);
          updateDatabaseInfo();
          const status=document.getElementById("dbStatus");
          if(status){status.className="db-status";status.textContent="🟢 DATABASE LOKAL TERHUBUNG";}
          appNotify("DATABASE LOKAL BERHASIL DIBACA!\n\nFile: "+file.name.replace(/\.(xlsx|xls)$/i,"")+"\nJumlah soal: "+BANK.length.toLocaleString("id-ID"),"DATABASE TERHUBUNG","✅");
        }catch(err){
          if(err && err.name!=="AbortError") appNotify("Database B@-it gagal dibuka.","DATABASE GAGAL DIBUKA","❌");
        }
      }else{
        input.value="";
        input.click();
      }
    }else{
      loginError.textContent="❌ USER atau PASSWORD salah.";
      loginPass.value="";
      loginPass.focus();
    }
  });

  input.addEventListener("change",async()=>{
    const file = input.files && input.files[0];
    if(!file) return;
    try{
      BANK = [];
      window.__BANK_READY = false;
      await loadBankFromExcel(file);
      updateDatabaseInfo();
      const status = document.getElementById("dbStatus");
      if(status){
        status.className="db-status";
        status.textContent="🟢 DATABASE LOKAL TERHUBUNG";
      }
      appNotify("DATABASE LOKAL BERHASIL DIBACA!\n\nFile: " + file.name.replace(/\.(xlsx|xls)$/i,"") + "\nJumlah soal: " + BANK.length.toLocaleString("id-ID"), "DATABASE TERHUBUNG", "✅", async ()=>{ await restoreExamSession(); });
    }catch(e){
      console.error(e);
      const status = document.getElementById("dbStatus");
      if(status){
        status.className="db-status error";
        status.textContent="🔴 DATABASE GAGAL DIBACA";
      }
      appNotify("Database B@-it gagal dibaca.\nPastikan file B@-it memiliki sheet BANK_SOAL dan kolom: ID, Kategori, Tingkat, Soal, A, B, C, D, E, Jawaban, Pembahasan.", "DATABASE GAGAL DIBACA", "❌");
    }
  });
})();


updateLocalDbButtonVisibility();

/* ================= LANJUTKAN SESI SETELAH ISTIRAHAT ================= */
$("resumeExam")?.addEventListener("click", async ()=>{
  await restoreExamSession();
});

/* ================= TOMBOL MODE ================= */
document.querySelectorAll("button.start[data-mode]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    start(btn.dataset.mode);
  });
});

/* Terapkan status kunci 4 level saat halaman dibuka. */
updateModeCards();

/* Pulihkan sesi otomatis setelah halaman selesai dimuat. */
window.addEventListener("load",async()=>{
  // Online: Excel dibaca dari server. Local: coba buka kembali HANDLE Excel yang disimpan.
  if(location.protocol==="file:" && !window.__BANK_READY){
    await restoreLocalDatabase();
  }
  await restoreExamSession();
});

window.addEventListener("beforeunload",()=>{
  saveExamSession();
});

