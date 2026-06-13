# Start Here — JARVIS for Beginners 🤖

Hi! This page tells you how to set up JARVIS.

You do **not** need to know anything about computers or code. We will go
slowly. One small step at a time. You can do this. 💪

---

## What is JARVIS?

JARVIS is a helper that lives inside your computer.

You talk to it. It listens. It helps you with things like:

- 📅 Your calendar (what you have to do today)
- ✉️ Your email (read it, write it, send it)
- 💵 Your money tools (look at your sales)
- 📂 Your files (open them, change them, tidy them up)

Think of JARVIS like a robot helper, like a friendly butler. 🤵

---

## 3 things to know first

1. **JARVIS is a robot helper.** You are the boss. It only does what you ask.
2. **We go one step at a time.** Do not jump ahead. Each step is small.
3. **You will not break anything.** If something looks wrong, you can stop and
   start over. It is okay to make mistakes.

---

## Some words to know

These are "computer words." Here is what they mean in plain talk:

- **Install** = put a program onto your computer (like adding an app to a
  phone).
- **Terminal** = a little box where you type words to tell the computer what to
  do. It looks plain and boring, but it is very powerful.
- **Code** = the secret words that make JARVIS work. You do **not** have to
  write any. It is already done for you.
- **Type a command** = copy some words, paste them in the terminal box, and
  press the **Enter** key.

That's it. You know enough now. Let's go! 🚀

---

# Part 1: Make JARVIS say hello 👋

This part gets JARVIS running on your computer. No accounts needed yet.

### Step 1 — Put the "engine" on your computer

JARVIS needs an engine to run. The engine is called **Node**.

- Go to this website: **https://nodejs.org**
- Click the big button that says **Download** (pick the one that says **LTS**).
- Open the file you downloaded and click **Next → Next → Finish** until it is
  done. (Just like installing any app.)

✅ When it is done, you have the engine. Great job!

### Step 2 — Get the JARVIS files

All of JARVIS's files live in one folder. You need that folder on your
computer. Ask your helper (or me!) to help you "download the repo" — that just
means copying the folder onto your computer.

✅ When you have the JARVIS folder on your computer, you are ready.

### Step 3 — Open the typing box (terminal)

- On a **Mac**: press the **Command key (⌘)** and **Space** at the same time.
  Type the word `Terminal` and press **Enter**.
- A plain window opens. That is the terminal. It is just a typing box. 🙂

### Step 4 — Tell the terminal where the JARVIS folder is

In the terminal, type the word `cd`, then a space, then drag the JARVIS folder
into the terminal window with your mouse. Then press **Enter**.

(`cd` means "go to this folder.")

### Step 5 — Type the two magic commands

Type this and press **Enter**:

```
npm install
```

This gets all the helper pieces ready. It may take a minute. You will see lots
of words scroll by. That is normal! Wait until it stops.

Then type this and press **Enter**:

```
npm start
```

### Step 6 — Say hi to JARVIS! 🎉

A window should open. It says **JARVIS** at the top.

Type **"hello"** in the box at the bottom and press **Send**.

JARVIS will write back! (At first it gives a pretend answer that starts with
`[STUB REPLY]`. That is okay — it just means JARVIS's "brain" is not turned on
yet. We turn it on later.)

🎉 **You did it! JARVIS is alive on your computer!** Take a break. You earned it.

---

# Part 2: Give JARVIS its brain and tools 🧠

You can do these **later**, one at a time, only when you are ready. You do
**not** have to do them all at once.

Each one needs a **key**. A key is like a password that lets JARVIS use one of
your things. You get each key from a website, then paste it into a special
file called `.env`. Your helper can walk you through each key.

- **The brain** (so JARVIS gives real answers): a key from Anthropic.
- **Calendar + Email**: a key from Google.
- **Money tools**: a key from Stripe. (We start in "test mode" — this is a
  pretend mode that cannot touch real money. Very safe.)

👉 The grown-up README has the click-by-click steps for each key. Do them one
at a time, with help. There is no rush.

---

# Part 3: The secret code lock 🔐

Some things JARVIS can do are **big deals** — like giving money back to a
customer, or deleting a file for good.

For those big things, JARVIS asks you **twice**:

1. You click **Confirm**.
2. You type a **6-number secret code**.

The secret code comes from an app on your phone called **Google
Authenticator**. The code changes every 30 seconds, like a magic password that
keeps changing. This keeps your money super safe. Even if someone copied your
voice, they could not do the big things — because they would not have your
phone. 📱

**How to set it up (one time):**

1. Open JARVIS on your computer.
2. Click **Settings**, then **Two-factor confirmation**.
3. Click **Set up authenticator**. A square picture (a QR code) shows up.
4. On your phone, open **Google Authenticator** and point the camera at the
   square.
5. Type the 6 numbers your phone shows back into JARVIS. Done! ✅

Now JARVIS will ask for those numbers before any big action.

---

# JARVIS is always safe 🛡️

- JARVIS **always asks first** before sending an email, spending money, or
  deleting a file.
- When JARVIS "deletes" a file, it really just moves it to a **trash** folder.
  You can get it back. Nothing is gone forever.
- You can press **Pause** any time to make JARVIS stop and just listen.

---

# If you get stuck 😕

That is okay! It happens to everyone.

- Read the step again, slowly.
- Make sure you pressed **Enter** after each command.
- Ask your helper (or me!) for help. Tell me which step number you are on and
  what you see on the screen.

You are doing great. One step at a time. 🌟
