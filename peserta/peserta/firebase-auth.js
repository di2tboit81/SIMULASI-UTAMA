import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile, deleteUser, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
window.firebaseAuth = auth;
window.firebaseDb = db;
window.__participantProfile = null;
window.__participantReady = false;
let registrationInProgress = false;
let resolveAuthReady;
window.__firebaseAuthReady = new Promise(resolve=>{ resolveAuthReady=resolve; });

const $ = id => document.getElementById(id);
const screen = $("authScreen");
const registerForm = $("registerForm");
const loginForm = $("loginParticipantForm");
const switchBtn = $("switchAuth");
const title = $("authTitle");
const subtitle = $("authSubtitle");
const registerError = $("registerError");
const loginError = $("loginParticipantError");

function setMessage(el, msg, ok=false){
  if(!el) return;
  el.textContent = msg || "";
  el.classList.toggle("success", !!ok);
}

function showLogin(clearMessages=true){
  registerForm?.classList.add("hidden");
  loginForm?.classList.remove("hidden");
  title.textContent = "LOGIN PESERTA";
  subtitle.textContent = "Masukkan username dan password yang sudah didaftarkan.";
  switchBtn.textContent = "Belum punya akun? DAFTAR";
  if(clearMessages){ setMessage(registerError, ""); setMessage(loginError, ""); }
}

function showRegister(clearMessages=true){
  loginForm?.classList.add("hidden");
  registerForm?.classList.remove("hidden");
  title.textContent = "DAFTAR PESERTA";
  subtitle.textContent = "Daftar dengan nama, username, dan password.";
  switchBtn.textContent = "Sudah punya akun? LOGIN";
  if(clearMessages){ setMessage(registerError, ""); setMessage(loginError, ""); }
}

function friendlyError(e){
  const c=e?.code||"";
  const map={
    "auth/email-already-in-use":"Akun dengan username tersebut sudah terdaftar.",
    "auth/weak-password":"Password terlalu lemah. Gunakan minimal 6 karakter.",
    "auth/invalid-credential":"Username atau password salah.",
    "auth/user-not-found":"Username atau password salah.",
    "auth/wrong-password":"Username atau password salah.",
    "auth/user-disabled":"Akun ini dinonaktifkan.",
    "auth/too-many-requests":"Terlalu banyak percobaan. Coba lagi nanti.",
    "account-in-use":"⚠️ AKUN SEDANG DIGUNAKAN di browser/perangkat lain. Silakan LOGOUT dari perangkat tersebut terlebih dahulu.",
    "auth/network-request-failed":"Koneksi internet bermasalah.",
    "permission-denied":"Akses Firebase ditolak. Periksa Firestore Rules dan pastikan akun memiliki izin yang sesuai.",
    "auth/invalid-api-key":"Konfigurasi Firebase tidak valid.",
    "auth/operation-not-allowed":"Metode login belum diaktifkan di Firebase Authentication."
  };
  return map[c] || (e?.message || "Terjadi kesalahan. Silakan coba lagi.");
}

// Firebase Authentication membutuhkan email secara internal.
// Peserta tidak perlu mengetahui atau mengisi email: kita buat alamat internal
// berdasarkan username. Username asli disimpan di Firestore sebagai indeks login.
function makeInternalEmail(username){
  return `${username.toLowerCase()}@login.simulasikat.local`;
}

window.showParticipantLogin = showLogin;
window.showParticipantRegister = showRegister;

registerForm?.addEventListener("submit", async e=>{
  e.preventDefault();
  setMessage(registerError, "");
  const name=$("registerName").value.trim();
  const username=$("registerUsername").value.trim().toLowerCase();
  const recoveryEmail=$("registerEmail").value.trim().toLowerCase();
  const pass=$("registerPassword").value;
  const pass2=$("registerPassword2").value;
  const submit=registerForm.querySelector("button[type=submit]");

  if(name.length < 3){ setMessage(registerError,"❌ Nama lengkap minimal 3 karakter."); return; }
  if(!/^[a-zA-Z0-9._-]{3,30}$/.test(username)){
    setMessage(registerError,"❌ Username 3–30 karakter: huruf, angka, titik, garis bawah, atau tanda minus."); return;
  }
  if(!recoveryEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail)){ setMessage(registerError,"❌ Email pemulihan wajib diisi dengan email yang valid."); return; }
  if(pass.length < 6){ setMessage(registerError,"❌ Password minimal 6 karakter."); return; }
  if(pass !== pass2){ setMessage(registerError,"❌ Konfirmasi password tidak sama."); return; }

  registrationInProgress = true;
  if(submit){ submit.disabled=true; submit.textContent="⏳ MENDAFTARKAN..."; }
  let createdUser = null;
  try{
    // Cek username sebelum membuat akun Authentication.
    const usernameRef = doc(db,"usernames",username);
    const usernameSnap = await getDoc(usernameRef);
    if(usernameSnap.exists()){
      setMessage(registerError,"❌ Username sudah digunakan. Silakan pilih username lain.");
      return;
    }

    // Email pemulihan menjadi email Auth utama agar fitur LUPA PASSWORD resmi Firebase dapat digunakan.
    const internalEmail = recoveryEmail;
    const cred=await createUserWithEmailAndPassword(auth,recoveryEmail,pass);
    createdUser = cred.user;
    await updateProfile(createdUser,{displayName:name});

    // Indeks username hanya menyimpan data minimum yang diperlukan untuk login.
    await setDoc(usernameRef,{
      uid:createdUser.uid,
      username,
      namaLengkap:name,
      authEmail:internalEmail,
      recoveryEmail,
      createdAt:serverTimestamp()
    });

    // Tidak membiarkan peserta langsung masuk setelah mendaftar.
    await signOut(auth);
    showLogin(false);
    $("participantUsername").value = username;
    $("participantPassword").value = "";
    setMessage(loginError,"✅ PENDAFTARAN BERHASIL! Username sudah tersimpan di Firebase. Silakan LOGIN.",true);
    setTimeout(()=>$("participantPassword")?.focus(),80);
  }catch(err){
    // Jika Auth berhasil tetapi penyimpanan username gagal, hapus akun Auth
    // agar tidak meninggalkan akun setengah jadi.
    if(createdUser){
      try{ await deleteUser(createdUser); }catch(_){ try{ await signOut(auth); }catch(__){} }
    }
    showRegister(false);
    setMessage(registerError,"❌ PENDAFTARAN GAGAL: "+friendlyError(err));
  } finally {
    registrationInProgress = false;
    if(submit){ submit.disabled=false; submit.textContent="DAFTAR"; }
  }
});


// ================= KUNCI SESI LOGIN 1 BROWSER =================
// Satu username hanya boleh aktif pada satu browser pada satu waktu.
// Logout hanya melepas kunci login; sesi ujian TIDAK dihapus sehingga
// posisi soal, jawaban, dan waktu tetap dapat dipulihkan setelah login lagi.
const SESSION_LOCK_TTL = 90 * 1000;
const SESSION_HEARTBEAT_MS = 30 * 1000;
const SESSION_LOCK_KEY = "SKD_IPDN_LOGIN_SESSION_V1";
let sessionHeartbeatTimer = null;
let sessionLockLost = false;
let loginLockAcquisitionInProgress = false;

function getBrowserSessionId(){
  let id="";
  try{ id=localStorage.getItem(SESSION_LOCK_KEY)||""; }catch(e){}
  if(!id){
    id = (crypto?.randomUUID ? crypto.randomUUID() : (Date.now()+"-"+Math.random().toString(36).slice(2)));
    try{ localStorage.setItem(SESSION_LOCK_KEY,id); }catch(e){}
  }
  return id;
}
const browserSessionId=getBrowserSessionId();

async function acquireLoginLock(user, username){
  const ref=doc(db,"users",user.uid,"loginSession","active");
  const now=Date.now();
  try{
    await runTransaction(db, async tx=>{
      const snap=await tx.get(ref);
      const old=snap.exists()?snap.data():null;
      const active=old && old.active===true && old.sessionId && old.sessionId!==browserSessionId
        && Number(old.lastSeen||0) > now-SESSION_LOCK_TTL;
      if(active){
        const err=new Error("ACCOUNT_IN_USE"); err.code="account-in-use"; throw err;
      }
      tx.set(ref,{uid:user.uid,username:String(username||""),sessionId:browserSessionId,active:true,lastSeen:now,updatedAt:serverTimestamp()},{merge:true});
    });
    sessionLockLost=false;
    startLoginHeartbeat(user, username);
    return true;
  }catch(err){
    if(err?.code==="account-in-use") throw err;
    console.error("Gagal mengunci sesi login",err);
    // Jika aturan Firebase belum mendukung lock baru, jangan membuat login
    // peserta rusak total; login tetap dapat berjalan seperti sebelumnya.
    return true;
  }
}

function startLoginHeartbeat(user, username){
  stopLoginHeartbeat();
  sessionHeartbeatTimer=setInterval(async()=>{
    if(!auth.currentUser || auth.currentUser.uid!==user.uid) return;
    const ref=doc(db,"users",user.uid,"loginSession","active");
    try{
      const snap=await getDoc(ref);
      const data=snap.exists()?snap.data():null;
      const profileSnap=await getDoc(doc(db,"users",user.uid));
      const profile=profileSnap.exists()?profileSnap.data():null;
      const profileStatus=String(profile?.status||"pending").toLowerCase();
      const profileEnd=profile?.activeUntil?.toMillis?profile.activeUntil.toMillis():new Date(profile?.activeUntil||0).getTime();
      if(profileStatus!=="active" || (profileEnd && profileEnd<=Date.now())){
        sessionLockLost=true;
        stopLoginHeartbeat();
        await releaseLoginLock(user);
        await signOut(auth);
        if(profileStatus==="disabled") setMessage(loginError,"⛔ AKUN DINONAKTIFKAN ADMIN. Silakan hubungi Admin.");
        else if(profileStatus==="rejected") setMessage(loginError,"❌ PENDAFTARAN DITOLAK ADMIN. Silakan hubungi Admin.");
        else setMessage(loginError,"⏰ MASA AKTIF AKUN TELAH BERAKHIR. Silakan minta Admin memperpanjang masa aktif.");
        return;
      }
      if(data && data.active===true && data.sessionId && data.sessionId!==browserSessionId){
        sessionLockLost=true;
        stopLoginHeartbeat();
        // Sesi ujian tetap disimpan; hanya akses akun pada browser ini yang ditutup.
        await signOut(auth);
        return;
      }
      await setDoc(ref,{uid:user.uid,username:String(username||""),sessionId:browserSessionId,active:true,lastSeen:Date.now(),updatedAt:serverTimestamp()},{merge:true});
    }catch(e){ console.warn("Heartbeat login gagal",e); }
  },SESSION_HEARTBEAT_MS);
}

function stopLoginHeartbeat(){
  if(sessionHeartbeatTimer){ clearInterval(sessionHeartbeatTimer); sessionHeartbeatTimer=null; }
}

async function releaseLoginLock(user=auth.currentUser){
  stopLoginHeartbeat();
  if(!user) return;
  const ref=doc(db,"users",user.uid,"loginSession","active");
  try{
    const snap=await getDoc(ref);
    const data=snap.exists()?snap.data():null;
    if(!data || data.sessionId===browserSessionId){
      await setDoc(ref,{uid:user.uid,active:false,sessionId:browserSessionId,lastSeen:0,updatedAt:serverTimestamp()},{merge:true});
    }
  }catch(e){ console.warn("Gagal melepas kunci login",e); }
}

window.releaseParticipantLoginLock=releaseLoginLock;
window.__loginLockBrowserSessionId=browserSessionId;

const forgotBtn=$("forgotPasswordBtn");
const forgotBox=$("forgotPasswordBox");
forgotBtn?.addEventListener("click",()=>{
  forgotBox?.classList.toggle("hidden");
  const u=$("participantUsername")?.value.trim().toLowerCase()||"";
  const fu=$("forgotUsername"); if(fu && u) fu.value=u;
});
$("sendForgotPassword")?.addEventListener("click",async()=>{
  const err=$("forgotPasswordError"); setMessage(err,"");
  const username=$("forgotUsername")?.value.trim().toLowerCase()||"";
  const email=$("forgotEmail")?.value.trim().toLowerCase()||"";
  const btn=$("sendForgotPassword");
  if(!username){ setMessage(err,"❌ Username wajib diisi."); return; }
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ setMessage(err,"❌ Email pemulihan tidak valid."); return; }
  if(btn){btn.disabled=true;btn.textContent="⏳ MENGIRIM...";}
  try{
    const snap=await getDoc(doc(db,"usernames",username));
    if(!snap.exists()){ setMessage(err,"❌ Username tidak ditemukan."); return; }
    const data=snap.data();
    const savedEmail=String(data.recoveryEmail||data.authEmail||"").toLowerCase();
    if(savedEmail!==email){ setMessage(err,"❌ Email pemulihan tidak cocok dengan akun tersebut."); return; }
    if(savedEmail.endsWith("@login.simulasikat.local")){ setMessage(err,"❌ Akun lama belum memiliki email pemulihan. Tambahkan email pemulihan terlebih dahulu saat akun masih bisa login."); return; }
    await sendPasswordResetEmail(auth,savedEmail);
    setMessage(err,"✅ LINK RESET PASSWORD SUDAH DIKIRIM. Periksa Inbox/Spam email Anda.",true);
  }catch(e){ setMessage(err,"❌ "+friendlyError(e)); }
  finally{ if(btn){btn.disabled=false;btn.textContent="📧 KIRIM LINK RESET";} }
});

loginForm?.addEventListener("submit", async e=>{
  e.preventDefault();
  setMessage(loginError, "");
  const username=$("participantUsername").value.trim().toLowerCase();
  const password=$("participantPassword").value;
  const submit=loginForm.querySelector("button[type=submit]");
  if(!username){ setMessage(loginError,"❌ Username wajib diisi."); return; }
  if(!password){ setMessage(loginError,"❌ Password wajib diisi."); return; }
  if(submit){ submit.disabled=true; submit.textContent="⏳ MEMERIKSA..."; }
  try{
    const snap=await getDoc(doc(db,"usernames",username));
    if(!snap.exists()){
      setMessage(loginError,"❌ Username tidak ditemukan.");
      return;
    }
    const data=snap.data();

    // Firestore Rules mewajibkan user sudah terautentikasi untuk membaca
    // users/{uid}. Karena itu autentikasi password dilakukan lebih dulu,
    // lalu status akun diperiksa. Jika belum ACC/ditolak/nonaktif, langsung
    // signOut kembali dan TIDAK membuat login lock.
    const cred=await signInWithEmailAndPassword(auth,data.authEmail,password);
    const profileSnap=await getDoc(doc(db,"users",data.uid));
    if(!profileSnap.exists()){
      await signOut(auth);
      setMessage(loginError,"❌ DATA AKUN PESERTA BELUM LENGKAP. Silakan hubungi Admin.");
      return;
    }
    const profile=profileSnap.data();
    const accountStatus=String(profile.status||"pending").toLowerCase();
    if(accountStatus==="pending"){
      await signOut(auth);
      setMessage(loginError,"⏳ AKUN BELUM DI-ACC ADMIN. Silakan tunggu persetujuan Admin terlebih dahulu.");
      return;
    }
    if(accountStatus==="disabled"){
      await signOut(auth);
      setMessage(loginError,"⛔ AKUN DINONAKTIFKAN ADMIN. Silakan hubungi Admin.");
      return;
    }
    if(accountStatus==="rejected"){
      await signOut(auth);
      setMessage(loginError,"❌ PENDAFTARAN DITOLAK ADMIN. Silakan hubungi Admin jika ingin mendaftar kembali.");
      return;
    }
    if(accountStatus!=="active"){
      await signOut(auth);
      setMessage(loginError,"❌ STATUS AKUN TIDAK VALID. Silakan hubungi Admin.");
      return;
    }
    const end=profile.activeUntil?.toMillis?profile.activeUntil.toMillis():new Date(profile.activeUntil||0).getTime();
    if(end && end<=Date.now()){
      await signOut(auth);
      setMessage(loginError,"⏰ MASA AKTIF AKUN TELAH BERAKHIR. Silakan minta Admin memperpanjang masa aktif.");
      return;
    }

    loginLockAcquisitionInProgress=true;
    try{
      await acquireLoginLock(cred.user, username);
    }catch(lockErr){
      try{ await signOut(auth); }catch(_){}
      if(lockErr?.code==="account-in-use") throw lockErr;
      throw lockErr;
    }
  }catch(err){
    setMessage(loginError,"❌ "+friendlyError(err));
  }finally{
    loginLockAcquisitionInProgress=false;
    if(submit){ submit.disabled=false; submit.textContent="LOGIN"; }
  }
});

$("participantLogout")?.addEventListener("click", async ()=>{
  const user=auth.currentUser;
  // Simpan posisi/jawaban/waktu terakhir ke Firebase sebelum logout.
  // Sesi ujian TIDAK dihapus.
  try{
    if(typeof window.saveExamSessionToCloudNow === "function") await window.saveExamSessionToCloudNow();
  }catch(e){ console.warn("Gagal menyimpan sesi sebelum logout",e); }
  await releaseLoginLock(user);
  await signOut(auth);
});

// ================= SINKRONISASI SESI UJIAN =================
// Satu dokumen per user + mode. Hanya progres sesi yang disimpan, bukan isi soal.
window.saveCloudExamSession = async function(payload){
  const user=auth.currentUser;
  if(!user || !payload || !payload.mode) return false;
  const ref=doc(db,"users",user.uid,"examSessions",String(payload.mode));
  await setDoc(ref,{
    uid:user.uid,
    name:String(payload.name||""),
    mode:String(payload.mode),
    questionIds:Array.isArray(payload.questionIds)?payload.questionIds:[],
    answers:Array.isArray(payload.answers)?payload.answers:[],
    flags:Array.isArray(payload.flags)?payload.flags:[],
    index:Number(payload.index)||0,
    seconds:Number(payload.seconds)||0,
    updatedAt:Number(payload.updatedAt)||Date.now()
  },{merge:true});
  return true;
};

window.loadCloudExamSession = async function(){
  const user=auth.currentUser;
  if(!user) return null;
  // Ambil sesi aktif dari mode yang sedang dijalankan jika localStorage punya mode;
  // jika tidak, cari 4 mode secara terbatas (maksimal 4 reads saat login).
  let preferredMode=null;
  try{
    const local=JSON.parse(localStorage.getItem("SKD_IPDN_ACTIVE_EXAM_V1")||"null");
    preferredMode=local?.mode||null;
  }catch(e){}
  const modes=preferredMode?[preferredMode]:["practice","simulation","cat","real"];
  const docs=[];
  for(const mode of modes){
    const snap=await getDoc(doc(db,"users",user.uid,"examSessions",mode));
    if(snap.exists()) docs.push(snap.data());
  }
  if(!docs.length) return null;
  docs.sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0));
  return docs[0];
};

window.clearCloudExamSession = async function(mode){
  const user=auth.currentUser;
  if(!user || !mode) return;
  try{ await deleteDoc(doc(db,"users",user.uid,"examSessions",String(mode))); }catch(e){}
};

const welcomeScreen = $("welcomeScreen");
const welcomeOk = $("welcomeOk");
const welcomeCancel = $("welcomeCancel");

function openParticipantLogin(){
  welcomeScreen?.classList.add("hidden");
  if(welcomeScreen) welcomeScreen.style.display="none";
  welcomeScreen?.setAttribute("aria-hidden", "true");
  if(screen){ screen.classList.remove("hidden"); screen.style.setProperty("display","flex","important"); }
  showLogin();
}
welcomeOk?.addEventListener("click", openParticipantLogin);
welcomeCancel?.addEventListener("click", ()=>{ welcomeCancel.blur(); });

let activeCardTimer=null;
function renderActivePeriod(profile){
  const rem=$("activePeriodRemaining"), until=$("activePeriodUntil"), card=$("activePeriodCard");
  if(!rem||!until) return;
  if(activeCardTimer){clearInterval(activeCardTimer);activeCardTimer=null;}
  const end=profile?.activeUntil?.toMillis?profile.activeUntil.toMillis():new Date(profile?.activeUntil||0).getTime();
  function paint(){
    const ms=end-Date.now();
    if(!end || !isFinite(end)){ rem.textContent="Belum ditentukan"; until.textContent="Hubungi Admin"; return; }
    if(ms<=0){ rem.textContent="KADALUARSA"; until.textContent="Masa aktif telah berakhir"; card?.classList.add("expired"); return; }
    card?.classList.remove("expired");
    const totalMin=Math.floor(ms/60000), days=Math.floor(totalMin/1440), hours=Math.floor((totalMin%1440)/60), mins=totalMin%60;
    rem.textContent=days?`${days} Hari ${hours} Jam`:hours?`${hours} Jam ${mins} Menit`:`${mins} Menit`;
    until.textContent="Aktif sampai "+new Date(end).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"});
  }
  paint(); activeCardTimer=setInterval(paint,60000);
}

onAuthStateChanged(auth, async user=>{
  const mainApp=$("mainApp");
  if(user && registrationInProgress){
    if(mainApp){ mainApp.classList.add("hidden"); mainApp.style.setProperty("display","none","important"); }
    if(screen){ screen.classList.remove("hidden"); screen.style.setProperty("display","flex","important"); }
    document.body.classList.remove("participant-authenticated");
    return;
  }
  if(user){
    // Validasi status akun juga saat refresh/reload, sebelum membuka aplikasi.
    try{
      const profileSnap=await getDoc(doc(db,"users",user.uid));
      if(!profileSnap.exists()){
        await signOut(auth);
        setMessage(loginError,"❌ DATA AKUN PESERTA BELUM LENGKAP. Silakan hubungi Admin.");
        return;
      }
      const profile=profileSnap.data();
      const accountStatus=String(profile.status||"pending").toLowerCase();
      const end=profile.activeUntil?.toMillis?profile.activeUntil.toMillis():new Date(profile.activeUntil||0).getTime();
      if(accountStatus==="pending"){
        await signOut(auth);
        setMessage(loginError,"⏳ AKUN BELUM DI-ACC ADMIN. Silakan tunggu persetujuan Admin terlebih dahulu.");
        return;
      }
      if(accountStatus==="disabled"){
        await signOut(auth);
        setMessage(loginError,"⛔ AKUN DINONAKTIFKAN ADMIN. Silakan hubungi Admin.");
        return;
      }
      if(accountStatus==="rejected"){
        await signOut(auth);
        setMessage(loginError,"❌ PENDAFTARAN DITOLAK ADMIN. Silakan hubungi Admin jika ingin mendaftar kembali.");
        return;
      }
      if(accountStatus!=="active" || (end && end<=Date.now())){
        await signOut(auth);
        setMessage(loginError,"⏰ MASA AKTIF AKUN TELAH BERAKHIR. Silakan minta Admin memperpanjang masa aktif.");
        return;
      }

      const name=(user.displayName||profile.namaLengkap||"").trim() || "Peserta";
      if(!loginLockAcquisitionInProgress && !sessionHeartbeatTimer){
        const usernameFromEmail=String(user.email||"").split("@")[0];
        acquireLoginLock(user, usernameFromEmail).catch(async err=>{
          if(err?.code==="account-in-use"){
            setMessage(loginError, "⚠️ AKUN SEDANG DIGUNAKAN di browser/perangkat lain. Silakan LOGOUT dari perangkat tersebut terlebih dahulu.");
            try{ await signOut(auth); }catch(_){}
          }
        });
      }
      window.__participantProfile={uid:user.uid,name,username:profile.username||"",activeUntil:profile.activeUntil||null};
      renderActivePeriod(profile);
      window.__participantReady=true;
      const n=$("participantName"); if(n) n.textContent=name;
      if(screen){ screen.classList.add("hidden"); screen.style.setProperty("display","none","important"); }
      if(mainApp){ mainApp.classList.remove("hidden"); mainApp.style.setProperty("display","block","important"); }
      document.body.classList.add("participant-authenticated");
      resolveAuthReady?.(user);
      setTimeout(()=>{ if(typeof window.restoreExamSession === "function") window.restoreExamSession(); }, 0);
    }catch(err){
      console.error("Gagal memvalidasi profil peserta",err);
      await signOut(auth).catch(()=>{});
      setMessage(loginError,"❌ Gagal memeriksa status akun. Silakan coba lagi.");
    }
  }else{
    window.__participantProfile=null;
    window.__participantReady=false;
    const n=$("participantName"); if(n) n.textContent="-";
    if(mainApp){ mainApp.classList.add("hidden"); mainApp.style.setProperty("display","none","important"); }
    if(screen){ screen.classList.remove("hidden"); screen.style.setProperty("display","flex","important"); }
    document.body.classList.remove("participant-authenticated");
    resolveAuthReady?.(null);
    showLogin(false);
  }
});
