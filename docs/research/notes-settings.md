# Research notes: Settings (menu Grok Bot > Settings..., or account menu > Settings)

Modal with left tabs: **General / Computer / Usage & Billing / Updates**. Every setting has a "Copy link to this setting" deep-link icon.

## General
- **Account**: avatar, name "Jop Middelkamp", email (copy icon), [Sign Out], [Add account].
- **Appearance**: Theme (Follow System), Language (Follow System).
- **System**: Microphone (System Default), "Use hardware acceleration" toggle, "Network Debugger - Check Grok Bot's connection." [Network Debugger].
- **Bot**:
  - Timezone: "Auto-detect (Asia/Saigon)".
  - **Auto-review** toggle (ON): "Grok Bot checks each action before it runs and asks you first when needed. Add rules to customize what it can do automatically."
  - **Auto-review Rules**: "Write one short, natural-language rule for each action. 'Ask first' takes priority if rules conflict." Form: "When Grok Bot wants to: [e.g. reply to emails for me]" / "It should: [Allow automatically v]" / [Add Rule]. Footer: "These rules apply only to you. Built-in safety checks always apply."
  - => SAFETY MODEL: a classifier-style gate ("Auto-review") on every action + user-authored natural-language allow/ask rules + non-overridable built-in checks. This is what blocked the TableCheck booking in Linh's chat.
- **Security Key**: "Use hardware security keys - Allow Grok Bot to use a security key (such as a YubiKey) connected to your computer. You'll be asked to approve each use." toggle.

## Computer
- **Computers** > "Current computer - This is the computer you are using now" label field "Jops-MacBook-Pro.local" [Save].
- "Execution on this computer - Let Grok Bot open files and run tasks on your computer. Auto-review still checks everything first." dropdown [Ask every time v].
- => The bots can also act on the USER'S LOCAL computer (desktop demo -> skill), gated per computer; default "Ask every time". (Jop does NOT want this in the rebuild.)

## Usage & Billing
- **Weekly Usage** progress bar (25%), "Resets in 6 days".
- "On-demand monthly limit - Billed through Cursor" [None v]; "Manage on-demand billing on Cursor" [Manage Billing ↗]. => confirms the product is built on Cursor's billing/infra.

## Updates
- Update Track (Stable), Automatic Updates toggle, "Version 0.47.0 - Updates follow the Stable track - You're up to date" [Check for Updates].
- **Grok Bot's Computer**: "Update Grok Bot's Computer - Updates the computer your assistants share. Your files and logins stay, but installed apps and packages are removed. All assistants update together." [Update]; "Reset Grok Bot's Computer - Start fresh if the computer gets stuck. It's rebuilt from your last saved snapshot, so very recent changes may be lost." [Reset].
- => ARCHITECTURE: ONE cloud Linux computer per account, SHARED by all assistants; per-agent data dirs under /home/box/agent-data/agents/<uuid>/; snapshot/restore; image updates wipe installed packages but keep files + logins.
