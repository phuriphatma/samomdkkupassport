# Contributing to Samo Passport ✈️ (A Beginner's Guide to Git)

Welcome to the team! If you are new to Git, don't worry. This guide will walk you through the exact steps to add features, fix bugs, and safely share your code without breaking the live website.

## 🧠 The Golden Rule of Git
Think of the `main` branch as the **Live Application** that medical students are currently using. **We never type code directly into `main`.** Instead, we make a temporary copy of the code called a **Branch**, do our work there, and then ask the team to review it via a **Pull Request (PR)**. Once approved, it gets **Merged** into `main`.

---

## 🛠️ The Standard Workflow (Step-by-Step)

Whenever you want to start working on something new, follow these exact steps.

### Step 1: Always Start Fresh (Pull)
Before making a new branch, you need to make sure your computer has the latest code that everyone else has been working on.

```bash
# 1. Switch to the main branch
git checkout main

# 2. Download (pull) the newest updates from GitHub
git pull origin main
```

### Step 2: Create a Workspace (Branch)
Now, create a safe space (branch) to make your changes. We use prefixes to keep things organized:
* **For a new feature:** `feat/your-feature-name` (e.g., `feat/new-continent-badge`)
* **For a bug fix:** `fix/what-you-fixed` (e.g., `fix/qr-code-styling`)

```bash
# The -b tells Git to create the branch AND switch to it immediately
git checkout -b feat/add-new-login-button
```
*You are now safe! Anything you do here will not affect the live website.*

### Step 3: Do Your Work & Save (Add & Commit)
Now, open your code editor (like VS Code), write your code, and test it locally using `npm run dev`. 

When you are happy with your changes, you need to save them into Git's history. This is a two-part process:

```bash
# 1. Stage your changes (Think of this as putting your changed files into a shipping box)
git add .

# 2. Commit your changes (Think of this as taping the box shut and putting a label on it)
git commit -m "feat: added a new blue login button to the index page"
```
*(Tip: Make your commit messages short but descriptive so the team knows what you did!)*

### Step 4: Upload Your Code (Push)
Your code is saved on your computer, but GitHub doesn't know about it yet. You need to "push" your branch to the cloud.

```bash
# Push your branch to GitHub. 
# You only need the "-u origin branch-name" the FIRST time you push a new branch.
git push -u origin feat/add-new-login-button
```
*(For any future pushes on this same branch, you can just type `git push`)*

### Step 5: Ask to Merge (Pull Request)
Because this project uses **Cloudflare Pages**, pushing your branch does something awesome: it creates a secret **Preview URL** just for your changes!

1. Go to the Samo Passport repository on **GitHub.com**.
2. You will see a green button that says **"Compare & pull request"**. Click it.
3. Give your Pull Request a title and a brief description of what you fixed or added.
4. Click **"Create pull request"**.
5. Wait a minute or two, and a bot will comment with a **Cloudflare Preview Link** (e.g., `https://feat-login.passport.pages.dev`). Click this link to test your code live on the internet!

### Step 6: Merge & Clean Up
Once another team member looks at your Pull Request and says it looks good, you can merge it.

1. On the GitHub Pull Request page, click the green **"Merge pull request"** button. (This moves your code into `main` and updates the real live website).
2. Click **"Delete branch"** on GitHub to keep things tidy.
3. Finally, go back to your terminal on your computer and clean up:

```bash
# Go back to the main branch
git checkout main

# Download the new merged code
git pull origin main

# Delete your old feature branch from your computer
git branch -d feat/add-new-login-button
```
**🎉 You're done! You can now start back at Step 1 for your next task.**

---

## 🚑 Quick Git Cheat Sheet

| Command | What it does |
| :--- | :--- |
| `git status` | Tells you what branch you are on and what files you have changed. Use this all the time! |
| `git log` | Shows you the history of recent commits. |
| `git checkout main` | Switches your view back to the main branch. |
| `git checkout <branch>` | Switches to an existing branch. |
| `git stash` | Temporarily hides your uncommitted changes if you need to switch branches quickly. |
| `git stash pop` | Brings your hidden changes back. |

### "Help, I'm stuck in a screen I can't exit!"
If Git opens a weird text editor (usually Vim) and you can't type or exit, type `:q!` and press **Enter**.