const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const ADMIN_SECRET = process.env.ADMIN_SECRET || "admin123";

// توليد كود عشوائي فريد - 4 bytes لكل جزء = 128 بت عشوائي
function generateCode() {
  const seg = () => crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}

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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ═══════════════ PUBLIC API ═══════════════

// تفعيل الكود
app.post("/api/activate", async (req, res) => {
  const code = (req.body.code || req.body.key || req.body.license || req.body.serial || "").trim().toUpperCase();
  const device_id = req.body.device_id || req.body.hwid || req.body.deviceId || "unknown";

  if (!code)
    return res.status(400).json({ success: false, message: "الكود مطلوب" });

  const { data, error } = await supabase
    .from("licenses").select("*").eq("code", code).single();

  if (error || !data)
    return res.json({ success: false, message: "الكود غير صحيح" });

  if (data.status === "disabled")
    return res.json({ success: false, message: "الكود معطل" });

  if (data.expires_at && new Date(data.expires_at) < new Date())
    return res.json({ success: false, message: "انتهت صلاحية الكود" });

  if (data.device_id && data.device_id !== device_id)
    return res.json({ success: false, message: "الكود مستخدم على جهاز آخر" });

  if (!data.device_id) {
    await supabase.from("licenses")
      .update({ device_id, activated_at: new Date().toISOString(), status: "active" })
      .eq("code", code);
  }

  return res.json({
    success: true,
    message: "تم التفعيل بنجاح",
    expires_at: formatDate(data.expires_at),
    plan: data.plan,
    code: data.code,
  });
});

// التحقق من الكود
app.post("/api/verify", async (req, res) => {
  const code = (req.body.code || req.body.key || req.body.license || "").trim().toUpperCase();
  const device_id = req.body.device_id || req.body.hwid || req.body.deviceId || "unknown";

  if (!code)
    return res.status(400).json({ success: false, message: "الكود مطلوب" });

  const { data, error } = await supabase
    .from("licenses").select("*").eq("code", code).single();

  if (error || !data)
    return res.json({ success: false, message: "الكود غير موجود" });

  if (data.status === "disabled")
    return res.json({ success: false, message: "الكود معطل" });

  if (data.expires_at && new Date(data.expires_at) < new Date())
    return res.json({ success: false, message: "انتهت الصلاحية" });

  if (data.device_id && data.device_id !== device_id)
    return res.json({ success: false, message: "جهاز غير مصرح" });

  return res.json({
    success: true,
    message: "الكود ساري",
    expires_at: formatDate(data.expires_at),
    plan: data.plan,
  });
});

// ═══════════════ ADMIN API ═══════════════

// إنشاء أكواد جديدة
app.post("/api/admin/generate", adminGuard, async (req, res) => {
  const count = Math.min(parseInt(req.body.count) || 1, 100);
  const plan = req.body.plan || "basic";
  const days = req.body.days ? parseInt(req.body.days) : null;
  const codes = [];

  for (let i = 0; i < count; i++) {
    const code = generateCode();
    const expires_at = days ? new Date(Date.now() + days * 86400000).toISOString() : null;

    const { error } = await supabase.from("licenses")
      .insert({ code, plan, expires_at, status: "pending" });

    if (!error) codes.push({ code });
  }

  res.json({ success: true, codes });
});

// قائمة الأكواد
app.get("/api/admin/keys", adminGuard, async (req, res) => {
  let query = supabase.from("licenses").select("*").order("created_at", { ascending: false });
  if (req.query.status) query = query.eq("status", req.query.status);
  if (req.query.plan) query = query.eq("plan", req.query.plan);
  const { data, error } = await query;
  if (error) return res.status(500).json({ success: false, message: error.message });
  res.json({ success: true, keys: data });
});

// تعطيل كود
app.post("/api/admin/disable", adminGuard, async (req, res) => {
  const code = (req.body.key || "").trim().toUpperCase();
  const { error } = await supabase.from("licenses").update({ status: "disabled" }).eq("code", code);
  if (error) return res.json({ success: false, message: error.message });
  res.json({ success: true, message: "تم تعطيل الكود" });
});

// تفعيل كود
app.post("/api/admin/enable", adminGuard, async (req, res) => {
  const code = (req.body.key || "").trim().toUpperCase();
  const { error } = await supabase.from("licenses").update({ status: "active" }).eq("code", code);
  if (error) return res.json({ success: false, message: error.message });
  res.json({ success: true, message: "تم تفعيل الكود" });
});

// حذف كود
app.post("/api/admin/delete", adminGuard, async (req, res) => {
  const code = (req.body.key || "").trim().toUpperCase();
  const { error } = await supabase.from("licenses").delete().eq("code", code);
  if (error) return res.json({ success: false, message: error.message });
  res.json({ success: true, message: "تم الحذف" });
});

// إعادة ضبط الجهاز
app.post("/api/admin/reset-device", adminGuard, async (req, res) => {
  const code = (req.body.key || "").trim().toUpperCase();
  const { error } = await supabase.from("licenses")
    .update({ device_id: null, activated_at: null, status: "pending" })
    .eq("code", code);
  if (error) return res.json({ success: false, message: error.message });
  res.json({ success: true, message: "تم إعادة ضبط الجهاز" });
});

// إحصائيات
app.get("/api/admin/stats", adminGuard, async (req, res) => {
  const { data } = await supabase.from("licenses").select("status, plan");
  if (!data) return res.json({ success: true, stats: { total: 0, active: 0, pending: 0, disabled: 0 } });
  res.json({
    success: true,
    stats: {
      total: data.length,
      active: data.filter((k) => k.status === "active").length,
      pending: data.filter((k) => k.status === "pending").length,
      disabled: data.filter((k) => k.status === "disabled").length,
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
