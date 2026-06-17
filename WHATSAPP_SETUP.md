# WhatsApp EMI Reminders — Setup Guide

This app can automatically WhatsApp customers ahead of each EMI due date
(default **7 days** and **3 days** before) with their name, amount, due date and
HP number. It uses the **Meta WhatsApp Cloud API** (cheapest option at our
volume — roughly ₹350–400/month for ~2,750 messages, vs ~4× that on Twilio).

There are two parts:
1. **Account / template setup at Meta** (the owner does this — see below).
2. **App configuration** (a few `.env` values + flipping the switch on).

WhatsApp does **not** allow free-form business-initiated messages. Every
reminder must use a **pre-approved template** in the **Utility** category. You
can edit the variable mapping and preview in the admin UI, but changing the
*wording* means re-submitting the template to Meta for approval (usually
minutes to a few hours).

---

## Part 1 — What to set up at Meta (owner)

### Step 1: Meta Business Account
- Go to **business.facebook.com** → create a Business Portfolio for **Sri Adithya Finance**.
- Enter the legal business name, address, business email, business phone, and a website **or** a Facebook Page (one is required).

### Step 2: Business Verification (unlocks real send limits)
In **Business Settings → Security Center → Business Verification**, submit:
- **A business document** (any one): GST registration certificate, Certificate of Incorporation/registration, Shops & Establishment license, or **Udyam / MSME** certificate.
- **Proof of address** if not shown on the above: a utility bill or bank statement with the **same business name + address**.
- A business **phone** and **email** that can receive a verification code.
- ⚠️ The business name on the documents must **exactly match** the name in Business Settings, or verification is rejected. Allow a few days.

### Step 3: WhatsApp number
- At **developers.facebook.com** → Create App → type **Business** → add the **WhatsApp** product. This creates a **WhatsApp Business Account (WABA)**.
- **Add a phone number** that is **NOT currently active on the WhatsApp or WhatsApp Business app** (delete it from there first if needed). It must receive an SMS or voice **OTP** to verify. A landline that can take a voice call works.
- Set a **Display Name** (what customers see, e.g. "Sri Adithya Finance"). It goes through a short review.

### Step 4: API credentials (these go into the app — Part 2)
From **WhatsApp → API Setup** and **Business Settings → Users → System Users**:
- **Phone number ID** — shown on the API Setup page.
- **Permanent access token** — create a **System User**, assign the **App** + **WABA** as assets, then **Generate token** with permissions **`whatsapp_business_messaging`** and **`whatsapp_business_management`**. (The token shown by default on the dashboard is temporary/24h — do **not** use it in production.)

### Step 5: Submit the message template
In **WhatsApp Manager → Message Templates → Create Template**:
- **Category:** **Utility** (transactional). Not Marketing — Utility is cheaper and higher-delivery, and reminders qualify.
- **Name:** lowercase + underscores, e.g. **`emi_reminder`** (this is the default the app expects; change it in the app's settings if you name it differently).
- **Language:** English (`en`); you can add Telugu (`te`) later.
- **Body** with numbered variables and **sample values** (Meta requires samples to approve):

  > Namaste {{1}}, your EMI of ₹{{2}} for vehicle finance {{4}} is due on {{3}}. Please pay on time to avoid issues. — Sri Adithya Finance

  | Variable | Meaning | Sample |
  |----------|---------|--------|
  | `{{1}}` | Customer name | Ramesh |
  | `{{2}}` | Amount (₹) | 8,500 |
  | `{{3}}` | Due date | 23-Jun-2026 |
  | `{{4}}` | HP / loan number | HP-1042 |

- Keep it transactional — no promotional wording — so it stays in the Utility category. Submit → approval is usually minutes to a few hours.

### Step 6: Billing
- **Business Settings → Billing** → add a card. Messages bill monthly (~₹0.12–0.14 per Utility message in India).

### Step 7: Consent
- WhatsApp policy requires customers to have **opted in**. Collect consent at loan signing or via SMS. The app already **skips the migrated `[REVIEW…]` placeholder numbers** and supports a per-customer opt-out, so you can review before going live.

### Owner checklist
Business name + address · GST/Udyam/registration doc · address proof · a dedicated phone number (not on WhatsApp) · business email · display name · billing card · approved template name.
**Then hand to the developer:** the **Phone number ID**, the **permanent access token**, and the **template name + language**.

---

## Part 2 — App configuration (developer)

Add to `backend/.env`:

```bash
# Master gate: registers the daily reminder job with the scheduler.
WHATSAPP_ENABLED=true
# Keep true until a template is approved and you've reviewed a dry-run.
WHATSAPP_DRY_RUN=true
# From Meta (Part 1, Step 4):
WHATSAPP_PHONE_NUMBER_ID=xxxxxxxxxxxxxxx
WHATSAPP_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# Optional (defaults shown):
WHATSAPP_API_VERSION=v21.0
WHATSAPP_DEFAULT_COUNTRY_CODE=91
WHATSAPP_JOB_HOUR=9
WHATSAPP_JOB_MINUTE=0
```

Apply the database migration (adds the settings table, log table, and the
per-customer / per-loan toggle columns):

```bash
cd backend
python migrate.py apply        # or: python migrate.py status
```

### Going live
1. Get the template approved at Meta (Part 1, Step 5).
2. In the app (admin → **Reminders**): set the template name/language, confirm the offsets (7 & 3 days) and send time, and **send a test message** to your own number.
3. Review a **dry run**: admin → Reminders → "Run now (dry-run)", then check the **reminder log** — confirm the right customers would be messaged and that `[REVIEW…]` / opted-out customers are skipped.
4. Set `WHATSAPP_DRY_RUN=false`, restart the backend, and turn the **global reminders switch ON** in the admin settings page.

### Switches at a glance
- **`WHATSAPP_ENABLED`** (env): whether the daily job is scheduled at all. Needs a restart to change.
- **Global on/off** (admin UI → `whatsapp_settings.reminders_enabled`): pause/resume all reminders without a restart.
- **Per-customer** toggle (customer page): opt one customer out.
- **Per-finance** toggle (loan page): mute one loan.
- A reminder is sent only when **all** are on, the customer isn't `[REVIEW…]`-flagged, and they have a valid phone number.
