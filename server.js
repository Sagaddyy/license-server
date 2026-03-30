const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const path = require("path");
const multer = require("multer");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ═══════════════ CONFIG ═══════════════
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
const ADMIN_SECRET     = process.env.ADMIN_SECRET     || "change-this-password";
const ADMIN_PANEL_PATH = process.env.ADMIN_PANEL_PATH || "x7k9p2m4q8r3";

// ═══════════════ FILE UPLOAD ═══════════════
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const u = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, u + path.extname(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// ═══════════════ HELPERS ═══════════════
function generateCode() {
  const seg = () => crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}
function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function adminGuard(req, res, next) {
  if (req.headers["x-admin-secret"] !== ADMIN_SECRET)
    return res.status(403).json({ success: false, message: "غير مصرح" });
  next();
}
function detectLang(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1);
  const map = {
    py:"Python",js:"JavaScript",ts:"TypeScript",tsx:"React TSX",jsx:"React JSX",
    cpp:"C++",cc:"C++",c:"C",h:"C Header",hpp:"C++ Header",java:"Java",
    kt:"Kotlin",swift:"Swift",rs:"Rust",go:"Go",rb:"Ruby",php:"PHP",
    html:"HTML",css:"CSS",scss:"SCSS",sql:"SQL",sh:"Shell",bash:"Bash",
    r:"R",dart:"Dart",lua:"Lua",json:"JSON",xml:"XML",yaml:"YAML",yml:"YAML",
    md:"Markdown",cs:"C#",vue:"Vue.js",svelte:"Svelte",zip:"ZIP Archive",
    gz:"GZ Archive",tar:"TAR Archive",apk:"Android APK",exe:"Executable",
    pdf:"PDF",txt:"Text",
  };
  const icons = {
    py:"🐍",js:"🟨",ts:"🔷",tsx:"⚛️",jsx:"⚛️",cpp:"⚙️",cc:"⚙️",c:"🔧",
    h:"📋",hpp:"📋",java:"☕",kt:"🟣",swift:"🍎",rs:"🦀",go:"🐹",rb:"💎",
    php:"🐘",html:"🌐",css:"🎨",scss:"💅",sql:"🗄️",sh:"🖥️",bash:"🖥️",
    r:"📊",dart:"🐦",lua:"🌙",json:"📄",xml:"📑",yaml:"⚙️",yml:"⚙️",
    md:"📝",cs:"🔵",vue:"💚",svelte:"🔥",zip:"📦",gz:"📦",tar:"📦",
    apk:"🤖",exe:"💻",pdf:"📕",txt:"📃",
  };
  const colors = {
    py:"#3776ab",js:"#f7df1e",ts:"#3178c6",tsx:"#61dafb",jsx:"#61dafb",
    cpp:"#00599c",java:"#e76f00",kt:"#7f52ff",swift:"#f05138",rs:"#ef4444",
    go:"#00add8",rb:"#cc342d",php:"#777bb4",html:"#e34f26",css:"#1572b6",
    scss:"#c6538c",sql:"#336791",sh:"#4eaa25",bash:"#4eaa25",r:"#276dc3",
    dart:"#0175c2",lua:"#6a5acd",json:"#fbbc04",cs:"#9b4993",vue:"#42b883",
    svelte:"#ff3e00",apk:"#3ddc84",pdf:"#e74c3c",
  };
  return {
    lang:  map[ext]   || ext.toUpperCase() || "Unknown",
    icon:  icons[ext] || "📄",
    color: colors[ext]|| "#64748b",
  };
}
function readFilesDB() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname,"files-db.json"),"utf8")); }
  catch { return []; }
}
function writeFilesDB(data) {
  fs.writeFileSync(path.join(__dirname,"files-db.json"), JSON.stringify(data,null,2));
}

// ═══════════════ PAGES ═══════════════
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")));

// ⭐ رابط لوحة التحكم السرية
app.get(`/${ADMIN_PANEL_PATH}`, (req, res) =>
  res.sendFile(path.join(__dirname, "admin.html")));

// ═══════════════ PUBLIC API ═══════════════
app.post("/api/activate", async (req, res) => {
  const code = (req.body.code||req.body.key||req.body.license||req.body.serial||"").trim().toUpperCase();
  const device_id = req.body.device_id||req.body.hwid||req.body.deviceId||"unknown";
  if (!code) return res.status(400).json({ success:false, message:"الكود مطلوب" });
  const { data, error } = await supabase.from("licenses").select("*").eq("code",code).single();
  if (error||!data) return res.json({ success:false, message:"الكود غير صحيح" });
  if (data.status==="disabled") return res.json({ success:false, message:"الكود معطل" });
  if (data.expires_at && new Date(data.expires_at)<new Date()) return res.json({ success:false, message:"انتهت صلاحية الكود" });
  if (data.device_id && data.device_id!==device_id) return res.json({ success:false, message:"الكود مستخدم على جهاز آخر" });
  if (!data.device_id)
    await supabase.from("licenses").update({ device_id, activated_at:new Date().toISOString(), status:"active" }).eq("code",code);
  return res.json({ success:true, message:"تم التفعيل بنجاح", expires_at:formatDate(data.expires_at), plan:data.plan, code:data.code });
});

app.post("/api/verify", async (req, res) => {
  const code = (req.body.code||req.body.key||req.body.license||"").trim().toUpperCase();
  const device_id = req.body.device_id||req.body.hwid||req.body.deviceId||"unknown";
  if (!code) return res.status(400).json({ success:false, message:"الكود مطلوب" });
  const { data, error } = await supabase.from("licenses").select("*").eq("code",code).single();
  if (error||!data) return res.json({ success:false, message:"الكود غير موجود" });
  if (data.status==="disabled") return res.json({ success:false, message:"الكود معطل" });
  if (data.expires_at && new Date(data.expires_at)<new Date()) return res.json({ success:false, message:"انتهت الصلاحية" });
  if (data.device_id && data.device_id!==device_id) return res.json({ success:false, message:"جهاز غير مصرح" });
  return res.json({ success:true, message:"الكود ساري", expires_at:formatDate(data.expires_at), plan:data.plan });
});

// ملفات عامة
app.get("/api/files", (req, res) => {
  const files = readFilesDB().filter(f=>f.visible!==false).map(f=>({
    id:f.id, name:f.originalName, description:f.description,
    lang:f.lang, icon:f.icon, color:f.color, size:f.size,
    uploadedAt:f.uploadedAt, downloads:f.downloads||0,
    requiresLicense:f.requiresLicense||false,
  }));
  res.json({ success:true, files });
});

// تحميل ملف
app.get("/api/files/:id/download", async (req, res) => {
  const files = readFilesDB();
  const file = files.find(f=>f.id===req.params.id);
  if (!file||file.visible===false) return res.status(404).json({ success:false, message:"غير موجود" });
  if (file.requiresLicense) {
    const code = (req.query.license||req.query.code||"").trim().toUpperCase();
    if (!code) return res.status(401).json({ success:false, message:"يتطلب ترخيص" });
    const { data } = await supabase.from("licenses").select("*").eq("code",code).single();
    if (!data||data.status==="disabled"||
       (data.expires_at && new Date(data.expires_at)<new Date()))
      return res.status(401).json({ success:false, message:"ترخيص غير صالح" });
  }
  file.downloads = (file.downloads||0)+1;
  writeFilesDB(files);
  res.download(path.join(uploadsDir, file.filename), file.originalName);
});

// ═══════════════ ADMIN API ═══════════════
app.post("/api/admin/upload", adminGuard, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ success:false, message:"لم يتم رفع ملف" });
  const info = detectLang(req.file.originalname);
  const entry = {
    id: crypto.randomUUID(),
    filename: req.file.filename,
    originalName: req.file.originalname,
    description: req.body.description || "",
    lang: info.lang, icon: info.icon, color: info.color,
    size: req.file.size,
    uploadedAt: new Date().toISOString(),
    downloads: 0, visible: true,
    requiresLicense: req.body.requiresLicense === "true",
  };
  const files = readFilesDB();
  files.unshift(entry);
  writeFilesDB(files);
  res.json({ success:true, file:entry });
});

app.get("/api/admin/files", adminGuard, (req, res) =>
  res.json({ success:true, files:readFilesDB() }));

app.post("/api/admin/files/:id/update", adminGuard, (req, res) => {
  const files = readFilesDB();
  const idx = files.findIndex(f=>f.id===req.params.id);
  if (idx===-1) return res.status(404).json({ success:false });
  files[idx] = { ...files[idx], ...req.body };
  writeFilesDB(files);
  res.json({ success:true });
});

app.delete("/api/admin/files/:id", adminGuard, (req, res) => {
  let files = readFilesDB();
  const file = files.find(f=>f.id===req.params.id);
  if (file) { try { fs.unlinkSync(path.join(uploadsDir,file.filename)); } catch {} }
  writeFilesDB(files.filter(f=>f.id!==req.params.id));
  res.json({ success:true });
});

app.post("/api/admin/generate", adminGuard, async (req, res) => {
  const count = Math.min(parseInt(req.body.count)||1, 100);
  const plan = req.body.plan||"basic";
  const days = req.body.days ? parseInt(req.body.days) : null;
  const codes = [];
  for (let i=0;i<count;i++) {
    const code = generateCode();
    const expires_at = days ? new Date(Date.now()+days*86400000).toISOString() : null;
    const { error } = await supabase.from("licenses").insert({ code, plan, expires_at, status:"pending" });
    if (!error) codes.push({ code });
  }
  res.json({ success:true, codes });
});

app.get("/api/admin/keys", adminGuard, async (req, res) => {
  let q = supabase.from("licenses").select("*").order("created_at",{ascending:false});
  if (req.query.status) q = q.eq("status",req.query.status);
  if (req.query.plan)   q = q.eq("plan",req.query.plan);
  const { data, error } = await q;
  if (error) return res.status(500).json({ success:false, message:error.message });
  res.json({ success:true, keys:data });
});

app.post("/api/admin/disable",      adminGuard, async (req,res) => { const c=(req.body.key||"").trim().toUpperCase(); const {error}=await supabase.from("licenses").update({status:"disabled"}).eq("code",c); res.json({success:!error,message:error?.message||"تم التعطيل"}); });
app.post("/api/admin/enable",       adminGuard, async (req,res) => { const c=(req.body.key||"").trim().toUpperCase(); const {error}=await supabase.from("licenses").update({status:"active"}).eq("code",c);   res.json({success:!error,message:error?.message||"تم التفعيل"}); });
app.post("/api/admin/delete",       adminGuard, async (req,res) => { const c=(req.body.key||"").trim().toUpperCase(); const {error}=await supabase.from("licenses").delete().eq("code",c);                   res.json({success:!error,message:error?.message||"تم الحذف"}); });
app.post("/api/admin/reset-device", adminGuard, async (req,res) => { const c=(req.body.key||"").trim().toUpperCase(); const {error}=await supabase.from("licenses").update({device_id:null,activated_at:null,status:"pending"}).eq("code",c); res.json({success:!error,message:error?.message||"تم الإعادة"}); });

app.get("/api/admin/stats", adminGuard, async (req, res) => {
  const { data } = await supabase.from("licenses").select("status,plan");
  const files = readFilesDB();
  res.json({ success:true, stats: {
    total:    data?.length||0,
    active:   data?.filter(k=>k.status==="active").length||0,
    pending:  data?.filter(k=>k.status==="pending").length||0,
    disabled: data?.filter(k=>k.status==="disabled").length||0,
    files:    files.length,
    downloads:files.reduce((s,f)=>s+(f.downloads||0),0),
  }});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server on port ${PORT}`);
  console.log(`🔐 Admin: /${ADMIN_PANEL_PATH}`);
});
