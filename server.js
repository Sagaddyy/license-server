const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// ── Supabase ──────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const ADMIN_SECRET = process.env.ADMIN_SECRET || "admin123";

// ── Helpers ───────────────────────────────────────────────
function generateKey() {
  const seg = () => crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}

// تحويل التاريخ من 2025-12-31T00:00:00.000Z إلى 2025-12-31 23:59:59
function formatDate(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

function adminGuard(req, res, next) {
  const secret = req.headers["x-admin-secret"];
  if (secret !== ADMIN_SECRET)
    return res.status(403).json({ success: false, message: "غير مصرح" });
  next();
}

// ── Home ──────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ═══════════════════════════════════════════════════════════
//  PUBLIC ENDPOINTS  (يستخدمها التطبيق APK)
// ═══════════════════════════════════════════════════════════

// ✅ تسجيل الدخول بـ UserId + Password
app.post("/api/activate", async (req, res) => {
  const username = req.body.UserId || req.body.username || req.body.key;
  const password = req.body.Password || req.body.password;
  const device_id = req.body.device_id || req.body.hwid || "unknown";

  if (!username || !password)
    return res.status(400).json({ success: false, message: "البيانات ناقصة" });

  const { data, error } = await supabase
    .from("licenses")
    .select("*")
    .eq("username", username)
    .single();

  if (error || !data)
    return res.json({ success: false, message: "اسم المستخدم غير صحيح" });

  if (data.password !== password)
    return res.json({ success: false, message: "كلمة المرور غير صحيحة" });

  if (data.status === "disabled")
    return res.json({ success: false, message: "الحساب معطل" });

  if (data.expires_at && new Date(data.expires_at) < new Date())
    return res.json({ success: false, message: "انتهت صلاحية الحساب" });

  if (data.device_id && data.device_id !== device_id)
    return res.json({ success: false, message: "الحساب مستخدم على جهاز آخر" });

  // ربط الجهاز أول مرة
  if (!data.device_id) {
    await supabase
      .from("licenses")
      .update({ device_id, activated_at: new Date().toISOString() })
      .eq("username", username);
  }

  return res.json({
    success: true,
    message: "تم تسجيل الدخول بنجاح",
    expires_at: formatDate(data.expires_at),
    plan: data.plan,
    username: data.username,
  });
});

// ✅ التحقق من الجلسة
app.post("/api/verify", async (req, res) => {
  const username = req.body.UserId || req.body.username || req.body.key;
  const device_id = req.body.device_id || req.body.hwid || "unknown";

  if (!username)
    return res.status(400).json({ success: false, message: "البيانات ناقصة" });

  const { data, error } = await supabase
    .from("licenses")
    .select("*")
    .eq("username", username)
    .single();

  if (error || !data)
    return res.json({ success: false, message: "الحساب غير موجود" });

  if (data.status === "disabled")
    return res.json({ success: false, message: "الحساب معطل" });

  if (data.expires_at && new Date(data.expires_at) < new Date())
    return res.json({ success: false, message: "انتهت الصلاحية" });

  if (data.device_id && data.device_id !== device_id)
    return res.json({ success: false, message: "جهاز غير مصرح" });

  return res.json({
    success: true,
    message: "الحساب ساري",
    expires_at: formatDate(data.expires_at),
    plan: data.plan,
  });
});

// ═══════════════════════════════════════════════════════════
//  ADMIN ENDPOINTS  (محمية بـ ADMIN_SECRET)
// ═══════════════════════════════════════════════════════════

// 🔑 إنشاء حسابات جديدة
app.post("/api/admin/generate", adminGuard, async (req, res) => {
  const { count = 1, plan = "basic", days = null, prefix = "user" } = req.body;
  const accounts = [];

  for (let i = 0; i < Math.min(count, 100); i++) {
    const username = `${prefix}${generateKey().split("-")[0]}`;
    const password = generateKey().split("-")[0] + generateKey().split("-")[1];
    const expires_at = days
      ? new Date(Date.now() + days * 86400000).toISOString()
      : null;

    const { error } = await supabase
      .from("licenses")
      .insert({ username, password, plan, expires_at, status: "active" });

    if (!error) accounts.push({ username, password });
  }

  res.json({ success: true, accounts });
});

// 📋 قائمة جميع الحسابات
app.get("/api/admin/keys", adminGuard, async (req, res) => {
  const { status, plan } = req.query;
  let query = supabase
    .from("licenses")
    .select("*")
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (plan) query = query.eq("plan", plan);
  const { data, error } = await query;
  if (error) return res.status(500).json({ success: false });
  res.json({ success: true, keys: data });
});

// 🚫 تعطيل حساب
app.post("/api/admin/disable", adminGuard, async (req, res) => {
  await supabase
    .from("licenses")
    .update({ status: "disabled" })
    .eq("username", req.body.key);
  res.json({ success: true, message: "تم تعطيل الحساب" });
});

// ✅ تفعيل حساب
app.post("/api/admin/enable", adminGuard, async (req, res) => {
  await supabase
    .from("licenses")
    .update({ status: "active" })
    .eq("username", req.body.key);
  res.json({ success: true, message: "تم تفعيل الحساب" });
});

// 🗑️ حذف حساب
app.post("/api/admin/delete", adminGuard, async (req, res) => {
  await supabase.from("licenses").delete().eq("username", req.body.key);
  res.json({ success: true, message: "تم الحذف" });
});

// 🔄 إعادة ضبط الجهاز
app.post("/api/admin/reset-device", adminGuard, async (req, res) => {
  await supabase
    .from("licenses")
    .update({ device_id: null, activated_at: null })
    .eq("username", req.body.key);
  res.json({ success: true, message: "تم إعادة ضبط الجهاز" });
});

// 📊 إحصائيات
app.get("/api/admin/stats", adminGuard, async (req, res) => {
  const { data } = await supabase.from("licenses").select("status, plan");
  if (!data) return res.json({ success: true, stats: { total: 0, active: 0, pending: 0, disabled: 0 } });
  const stats = {
    total: data.length,
    active: data.filter((k) => k.status === "active").length,
    pending: data.filter((k) => k.status === "pending").length,
    disabled: data.filter((k) => k.status === "disabled").length,
  };
  res.json({ success: true, stats });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
