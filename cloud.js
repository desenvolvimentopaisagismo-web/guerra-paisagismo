import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CFG = window.GP_CONFIG || {};
const KEY = "guerraPaisagismoVisitasFinal";
const enabled = Boolean(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
let supabase = null;
let session = null;
let profile = null;

function db(){ return JSON.parse(localStorage.getItem(KEY)||"[]"); }
function saveDB(a){ localStorage.setItem(KEY, JSON.stringify(a)); }
function el(id){ return document.getElementById(id); }

function setCloudUI(){
  el("cloudDisabled")?.classList.toggle("hidden", enabled);
  el("cloudEnabled")?.classList.toggle("hidden", !enabled);
  if(!enabled){
    if(el("cloudStatusBtn")) el("cloudStatusBtn").textContent = "☁ Local";
    return;
  }
  const logged = Boolean(session?.user);
  el("cloudLoginBtn")?.classList.toggle("hidden", logged);
  el("cloudLogoutBtn")?.classList.toggle("hidden", !logged);
  el("cloudUserBox")?.classList.toggle("hidden", !logged);
  el("cloudSyncBox")?.classList.toggle("hidden", !logged);
  if(el("cloudStatusBtn")) el("cloudStatusBtn").textContent = logged ? "☁ Conectado" : "☁ Entrar";
  if(logged && el("cloudUserBox")){
    el("cloudUserBox").innerHTML = `<b>${profile?.full_name || session.user.email}</b><br>
      Perfil: ${profile?.role || "usuário"} • Organização: ${profile?.organization_name || profile?.org_id || "-"}`;
  }
}

async function init(){
  if(!enabled){ setCloudUI(); return; }
  supabase = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  const { data } = await supabase.auth.getSession();
  session = data.session;
  if(session) await loadProfile();
  setCloudUI();
  await refreshStats();
  supabase.auth.onAuthStateChange(async (_event, newSession)=>{
    session = newSession;
    profile = null;
    if(session) await loadProfile();
    setCloudUI();
    await refreshStats();
  });
}
async function loadProfile(){
  if(!session?.user) return null;
  const { data, error } = await supabase.from("profiles")
    .select("id, full_name, role, org_id, organizations(name)")
    .eq("id", session.user.id)
    .single();
  if(error) throw error;
  profile = {
    id:data.id, full_name:data.full_name, role:data.role, org_id:data.org_id,
    organization_name:data.organizations?.name || ""
  };
  return profile;
}
async function login(){
  const email = el("cloudEmail").value.trim();
  const password = el("cloudPassword").value;
  if(!email || !password) return alert("Informe e-mail e senha.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if(error) return alert("Não foi possível entrar: " + error.message);
  session = data.session;
  await loadProfile();
  setCloudUI();
  alert("Login realizado.");
}
async function logout(){
  await supabase.auth.signOut();
  session = null; profile = null; setCloudUI();
}
function requireSession(){
  if(!enabled) throw new Error("Nuvem não configurada.");
  if(!session?.user) throw new Error("Faça login primeiro.");
}
function dataUrlToBlob(dataUrl){
  const [head,body] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(head)?.[1] || "image/jpeg";
  const bytes = Uint8Array.from(atob(body), c=>c.charCodeAt(0));
  return new Blob([bytes], {type:mime});
}
async function uploadPhotos(record, cloudId){
  const paths=[];
  const localPhotos = Array.isArray(record.fotos) ? record.fotos : [];
  for(let i=0;i<localPhotos.length;i++){
    const p=localPhotos[i];
    if(!p?.url?.startsWith("data:")) continue;
    const path = `${profile.org_id}/${cloudId}/${i}.jpg`;
    const { error } = await supabase.storage.from(CFG.STORAGE_BUCKET).upload(path, dataUrlToBlob(p.url), {
      upsert:true, contentType:"image/jpeg"
    });
    if(error) throw error;
    paths.push(path);
  }
  return paths;
}
function stripLocalHeavyFields(record){
  const copy = structuredClone(record);
  copy.fotos = [];
  copy.assinatura = "";
  return copy;
}
async function push(){
  requireSession();
  const records = db();
  let sent=0;
  for(const rec of records){
    const payload = stripLocalHeavyFields(rec);
    let row = null;
    if(rec._cloudId){
      const { data, error } = await supabase.from("visits")
        .update({ payload, updated_at:new Date().toISOString() })
        .eq("id", rec._cloudId)
        .select("id, client_ref")
        .single();
      if(error) throw error;
      row = data;
    } else {
      const { data, error } = await supabase.from("visits")
        .insert({
          org_id: profile.org_id,
          created_by: session.user.id,
          client_ref: String(rec.id),
          payload
        })
        .select("id, client_ref")
        .single();
      if(error) throw error;
      row = data;
      rec._cloudId = row.id;
    }
    const photoPaths = await uploadPhotos(rec, row.id);
    if(photoPaths.length){
      const { error } = await supabase.from("visits")
        .update({ photo_paths: photoPaths })
        .eq("id", row.id);
      if(error) throw error;
    }
    rec._syncedAt = new Date().toISOString();
    sent++;
  }
  saveDB(records);
  await refreshStats();
  return sent;
}
async function signedPhotos(paths){
  const out=[];
  for(const path of (paths||[])){
    const { data, error } = await supabase.storage.from(CFG.STORAGE_BUCKET).createSignedUrl(path, 3600);
    if(!error && data?.signedUrl) out.push({url:data.signedUrl, nome:path.split("/").pop(), cloudPath:path});
  }
  return out;
}
async function pull(){
  requireSession();
  const { data, error } = await supabase.from("visits")
    .select("id, client_ref, payload, photo_paths, updated_at, created_by")
    .order("updated_at", {ascending:false});
  if(error) throw error;
  const local = db();
  const byCloud = new Map(local.filter(x=>x._cloudId).map(x=>[x._cloudId,x]));
  const byRef = new Map(local.map(x=>[String(x.id),x]));
  for(const row of data||[]){
    let existing = byCloud.get(row.id) || byRef.get(String(row.client_ref));
    const incoming = row.payload || {};
    incoming._cloudId = row.id;
    incoming._syncedAt = row.updated_at;
    incoming._cloudCreatedBy = row.created_by;
    if(existing){
      // Preserve local data-URL photos whenever available for offline use.
      const localDataPhotos = (existing.fotos||[]).filter(p=>p?.url?.startsWith("data:"));
      incoming.fotos = localDataPhotos.length ? localDataPhotos : await signedPhotos(row.photo_paths);
      const idx = local.findIndex(x=>x===existing);
      local[idx] = incoming;
    } else {
      incoming.fotos = await signedPhotos(row.photo_paths);
      local.push(incoming);
    }
  }
  local.sort((a,b)=>(b.cliente?.dataVisita||"").localeCompare(a.cliente?.dataVisita||""));
  saveDB(local);
  await refreshStats();
  return data?.length || 0;
}
async function syncAll(){
  try{
    const sent = await push();
    const received = await pull();
    alert(`Sincronização concluída.\nEnviados: ${sent}\nRegistros na nuvem: ${received}`);
    location.reload();
  }catch(e){ alert("Falha na sincronização: " + e.message); }
}
async function refreshStats(){
  if(!enabled || !session?.user){
    if(el("cloudStats")) el("cloudStats").textContent="Entre para sincronizar.";
    return;
  }
  const local=db(), pending=local.filter(x=>!x._syncedAt).length;
  const { count } = await supabase.from("visits").select("*",{count:"exact",head:true});
  if(el("cloudStats")) el("cloudStats").innerHTML = `<b>Status</b><br>Registros locais: ${local.length}<br>Pendentes de primeiro envio: ${pending}<br>Registros disponíveis na nuvem: ${count ?? "-"}`;
}

window.cloudLogin = ()=>login().catch(e=>alert(e.message));
window.cloudLogout = ()=>logout().catch(e=>alert(e.message));
window.cloudPush = async()=>{try{const n=await push();alert(`${n} visita(s) enviadas.`)}catch(e){alert(e.message)}};
window.cloudPull = async()=>{try{const n=await pull();alert(`${n} registro(s) lidos da nuvem.`);location.reload()}catch(e){alert(e.message)}};
window.cloudSyncAll = syncAll;
window.cloudRefreshStatus = ()=>refreshStats().catch(e=>alert(e.message));

init().catch(e=>{
  console.error(e);
  if(el("cloudStats")) el("cloudStats").textContent="Erro na inicialização da nuvem: "+e.message;
});
