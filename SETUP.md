# Lock / Float Advisor — Complete Setup Guide
### Cook Inlet Lending Center

This guide takes you from the downloaded zip file to a live, auto-updating dashboard
your loan officers can use. **No coding. No command line.** Everything is done through
websites by clicking buttons.

Total time: about 30–40 minutes, most of it waiting on free account signups.

When you finish, you'll have a web page that recomputes a Lock / Float recommendation
for your 15, 30, 45, and 60-day windows every 30 minutes, around the clock.

---

# Before you start — what you'll be making accounts for

All free. Make these three accounts first (or as you reach each step):

1. **GitHub** — github.com — this holds the tool's files online.
2. **Vercel** — vercel.com — this runs the tool and shows the web page.
3. **cron-job.org** — cron-job.org — this presses the "update" button every 30 min.

You'll also need the two API keys you already have:
- FRED key (data)
- NewsAPI key (headlines)

> ⚠️ IMPORTANT: You shared those two keys in a chat earlier, so regenerate fresh ones
> before going live. FRED: fredaccount.stlouisfed.org/apikey · NewsAPI: your newsapi.org
> dashboard. Use the NEW keys everywhere below.

---

# PART 1 — Put the files on GitHub

### Step 1.1 — Unzip the download
Unzip `lockfloat-advisor.zip`. Inside you'll find a folder named **lockfloat**.
Open it. You should see folders named `api`, `lib`, `public`, `scripts`, and loose
files like `package.json` and `vercel.json`. This is what you're uploading.

### Step 1.2 — Make a GitHub account
Go to **github.com** and sign up (free). Verify your email.

### Step 1.3 — Create an empty repository
1. Click the **+** in the top-right corner → **New repository**.
2. Repository name: **lockfloat**
3. Set it to **Private** (this is internal company tooling).
4. Do NOT check "Add a README." Leave everything else blank.
5. Click **Create repository**.

### Step 1.4 — Upload the files
1. On the new empty repo page, find the link **"uploading an existing file"**
   (it's in the gray text near the middle).
2. Open your **lockfloat** folder on your computer.
3. Select everything INSIDE it (the `api`, `lib`, `public`, `scripts` folders and all
   the loose files) and drag them into the browser upload box.
   - If dragging individual folders doesn't work, drag the whole `lockfloat` folder in
     at once — GitHub keeps the structure either way.
4. Scroll down, click **Commit changes**.

✅ Done with GitHub. Your files now live online.

> Never upload a file containing your REAL keys. The included `.env.example` only has
> fake placeholder text, so it's safe. Real keys go into Vercel later (Part 2).

---

# PART 2 — Deploy on Vercel

### Step 2.1 — Make a Vercel account
Go to **vercel.com** → **Sign Up** → choose **"Continue with GitHub"** (easiest, links
the two automatically).

### Step 2.2 — Import your repository
1. On the Vercel dashboard, click **Add New… → Project**.
2. Find **lockfloat** in the list of your GitHub repos → click **Import**.
3. Leave all the build settings at their defaults.
4. Click **Deploy**. Wait ~1 minute for it to finish. (It'll show fireworks.)

> Don't worry that it might look blank or "demo" right now — we add the data in the
> next steps.

### Step 2.3 — Add the storage (Redis)
This is where the tool saves its latest reading.
1. In your project, click the **Storage** tab → **Create Database**.
2. Choose **Upstash → Redis**. Give it any name. Click **Create**, then **Connect**
   it to your project if asked.
3. **IGNORE** the page of code instructions Upstash shows afterward ("install SDK,"
   "pull env," etc.) — that's for programmers. You're done once the database is connected.

Connecting it automatically adds the storage keys to your project. You don't touch those.

### Step 2.4 — Add your other keys
1. In your project, go to **Settings → Environment Variables**.
2. Add these three, one at a time (Name on the left, your value on the right):

   | Name             | Value                                              |
   |------------------|----------------------------------------------------|
   | `FRED_API_KEY`   | your (newly regenerated) FRED key                  |
   | `NEWSAPI_KEY`    | your (newly regenerated) NewsAPI key               |
   | `CRON_SECRET`    | any long random text you invent, e.g. `cilc-lock-7f3k9q2x` |

   - Type the name EXACTLY as shown (capital letters and underscores matter).
   - For each, leave all three environment boxes checked, click **Save**.

3. After adding all three, go to the **Deployments** tab → click the **⋯** menu on the
   latest deployment → **Redeploy**. This makes the new keys take effect.

### Step 2.5 — Turn it on for the first time
1. Find your live web address. It's on the project's main page, like:
   `https://lockfloat-xxxx.vercel.app`
2. In your browser, visit this address, adding `/api/update?key=` and your secret:
   ```
   https://lockfloat-xxxx.vercel.app/api/update?key=YOUR_CRON_SECRET
   ```
   (replace `YOUR_CRON_SECRET` with the exact text you used in Step 2.4)
3. You should see a page of text starting with `{"ok":true,...}` and your verdicts.
   **That means it worked** — it just pulled live data and saved the first snapshot.
4. Now visit your plain web address (no `/api/...`):
   `https://lockfloat-xxxx.vercel.app`
   The dashboard should show live numbers and a fresh "As of…" timestamp.

✅ The tool is live. The last part makes it update itself automatically.

---

# PART 3 — Make it auto-update every 30 minutes

Vercel's free plan only lets its built-in scheduler run once a day — too slow. So a free
outside service presses the update button for you every 30 minutes.

### Step 3.1 — Make a cron-job.org account
Go to **cron-job.org** → sign up free → verify email.

### Step 3.2 — Create the scheduled job
1. Click **Create cronjob**.
2. **Title:** Lock/Float update
3. **URL:** paste your update address from Step 2.5:
   ```
   https://lockfloat-xxxx.vercel.app/api/update?key=YOUR_CRON_SECRET
   ```
4. **Schedule:** choose **Every 30 minutes** (use the "Every X minutes" option, set 30).
   (Hourly is also fine — your call.)
5. Click **Create**.

### Step 3.3 — Confirm it's running
After 30 minutes, cron-job.org shows a green ✓ next to the job. Reload your dashboard —
the "As of…" time should be recent. From now on it refreshes on its own, day and night.

✅ Fully live and self-updating.

---

# PART 4 — Put it in front of your loan officers

Pick one:

**A) Share the link.** Send LOs your `https://lockfloat-xxxx.vercel.app` address.
   To keep it internal-only, go to project **Settings → Deployment Protection** and turn
   on password protection (Vercel Pro) or use Vercel's free "Vercel Authentication" so
   only invited team members can open it.

**B) Embed it inside Monday.com.** On a Monday board/dashboard, add an **Embed (iframe)**
   widget and paste your Vercel web address. Your LOs then see the live advisor right
   inside the CRM they already use — no new tab, no new login.

---

# Quick reference — what each piece does

| Piece            | Job                                                          |
|------------------|-------------------------------------------------------------|
| GitHub           | Stores the files online                                     |
| Vercel           | Runs the tool + shows the web page                          |
| Upstash (Redis)  | Saves the latest reading so the page loads instantly        |
| cron-job.org     | Presses "update" every 30 min so data stays fresh           |
| FRED key         | The economic data (Treasury, Fed, CPI, PPI, oil)            |
| NewsAPI key      | The news headlines                                          |
| CRON_SECRET      | A password protecting the update button                    |

You skipped the optional Anthropic key — that's fine. The tool runs fully on the data
and news; you just don't get the AI-written narrative paragraph.

---

# If something goes wrong

- **The `/api/update` page shows an error instead of `{"ok":true}`** — usually a key is
  mistyped. Recheck Step 2.4 names/values, redeploy, try the URL again. Send me the exact
  error text and I'll pinpoint it.
- **Dashboard says "demo data (backend not connected)"** — the page loaded but couldn't
  reach the saved snapshot. Make sure you did Step 2.5 (visited the update URL once) and
  that the Redis storage from Step 2.3 is connected.
- **cron-job.org shows a red X** — the URL or secret is wrong. Recopy the exact update
  address from Step 2.5.

---

# Things you can ask me to change later

- How aggressive "Lock Now" is (the decision thresholds).
- How much each factor counts for each window.
- Update speed (30 min vs hourly).
- Adding live Alaska factors (oil, North Slope jobs, local inventory).
- Adding the AI narrative back in (needs the Anthropic key).
