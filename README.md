# 🔑 License Activation Server

سيرفر تفعيل كود لتطبيقات Android APK

---

## 📁 هيكل المشروع

```
license-server/
├── server.js          ← السيرفر الرئيسي
├── package.json       ← المكتبات
├── public/
│   └── index.html     ← لوحة التحكم
└── README.md
```

---

## 🚀 خطوات النشر (مجاناً)

### الخطوة 1 — إنشاء قاعدة البيانات (Supabase)

1. اذهب إلى https://supabase.com وسجّل مجاناً
2. أنشئ مشروع جديد
3. اذهب إلى **SQL Editor** وشغّل هذا الكود:

```sql
create table licenses (
  id uuid default gen_random_uuid() primary key,
  key text unique not null,
  status text default 'pending',      -- pending | active | disabled
  plan text default 'basic',          -- basic | pro | lifetime
  device_id text,
  expires_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz default now()
);

-- فهرسة للسرعة
create index on licenses (key);
create index on licenses (device_id);
```

4. من **Settings > API**، انسخ:
   - `Project URL`  → هذا هو `SUPABASE_URL`
   - `anon public key` → هذا هو `SUPABASE_KEY`

---

### الخطوة 2 — رفع الكود على GitHub

1. أنشئ Repository جديد على GitHub
2. ارفع الملفات:
   ```
   git init
   git add .
   git commit -m "init"
   git remote add origin https://github.com/USERNAME/REPO.git
   git push -u origin main
   ```

---

### الخطوة 3 — الاستضافة على Render.com

1. اذهب إلى https://render.com وسجّل مجاناً
2. **New Web Service** ← ربطه بـ GitHub Repository
3. الإعدادات:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. من **Environment Variables** أضف:

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | رابط مشروعك في Supabase |
| `SUPABASE_KEY` | المفتاح العام |
| `ADMIN_SECRET` | كلمة سر قوية مثل: `MySecret2024!` |

5. اضغط **Deploy** ✅

---

## 🔌 API للتطبيق (APK)

### تفعيل الكود
```
POST https://YOUR-APP.onrender.com/api/activate
Content-Type: application/json

{
  "key": "XXXXXX-XXXXXX-XXXXXX-XXXXXX",
  "device_id": "DEVICE_UNIQUE_ID"
}
```

**الرد عند النجاح:**
```json
{
  "success": true,
  "message": "تم التفعيل بنجاح",
  "plan": "pro",
  "expires_at": "2025-12-31T00:00:00.000Z"
}
```

---

### التحقق من الكود (عند كل فتح)
```
POST https://YOUR-APP.onrender.com/api/verify
Content-Type: application/json

{
  "key": "XXXXXX-XXXXXX-XXXXXX-XXXXXX",
  "device_id": "DEVICE_UNIQUE_ID"
}
```

---

## 📱 كود Android (Java/Kotlin)

```java
// Java - نموذج استدعاء API
private void verifyLicense(String key, String deviceId) {
    new Thread(() -> {
        try {
            URL url = new URL("https://YOUR-APP.onrender.com/api/verify");
            HttpURLConnection con = (HttpURLConnection) url.openConnection();
            con.setRequestMethod("POST");
            con.setRequestProperty("Content-Type", "application/json");
            con.setDoOutput(true);

            String json = "{\"key\":\"" + key + "\",\"device_id\":\"" + deviceId + "\"}";
            con.getOutputStream().write(json.getBytes());

            BufferedReader br = new BufferedReader(new InputStreamReader(con.getInputStream()));
            StringBuilder response = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) response.append(line);

            JSONObject result = new JSONObject(response.toString());
            boolean success = result.getBoolean("success");

            runOnUiThread(() -> {
                if (success) {
                    // ✅ الكود صحيح - افتح التطبيق
                } else {
                    // ❌ الكود خاطئ
                    String msg = result.getString("message");
                    Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
                }
            });
        } catch (Exception e) {
            e.printStackTrace();
        }
    }).start();
}

// للحصول على Device ID
private String getDeviceId() {
    return Settings.Secure.getString(
        getContentResolver(),
        Settings.Secure.ANDROID_ID
    );
}
```

---

## 🎛️ لوحة التحكم

افتح الرابط: `https://YOUR-APP.onrender.com`

- **توليد مفاتيح**: حدد الكمية والباقة والمدة
- **تعطيل مفتاح**: لإيقاف مفتاح مسرَّب
- **إعادة ضبط الجهاز**: لتغيير الجهاز المرتبط
- **حذف مفتاح**: حذف نهائي

---

## ⚙️ المتغيرات البيئية

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | رابط Supabase |
| `SUPABASE_KEY` | مفتاح Supabase العام |
| `ADMIN_SECRET` | كلمة سر لوحة التحكم |
| `PORT` | يضبطها Render تلقائياً |

---

## 📊 API الإدارة (محمية)

كل الطلبات تحتاج header:
```
x-admin-secret: YOUR_ADMIN_SECRET
```

| Method | Endpoint | الوظيفة |
|--------|----------|---------|
| POST | `/api/admin/generate` | توليد مفاتيح |
| GET | `/api/admin/keys` | عرض الكل |
| POST | `/api/admin/disable` | تعطيل |
| POST | `/api/admin/enable` | تفعيل |
| POST | `/api/admin/delete` | حذف |
| POST | `/api/admin/reset-device` | إعادة ضبط الجهاز |
| GET | `/api/admin/stats` | الإحصائيات |
