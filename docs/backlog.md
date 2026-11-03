# Shop Book (working name): Backlog

The full product backlog for Shop Book, a bookkeeping app for market traders: products and stock, sales, payments, debts, and a team that works offline and syncs. **Part 1** lists the user stories. In **Part 2**, each user story group becomes an **epic** and goes through four steps:

**How the documents fit together:** this backlog says **what** to build and why; `docs/server-plan.md` and `docs/app-plan.md` say **how**; Claude Code works in two separate projects, each with its own `CLAUDE.md`: the backend (`STOREBOK_BACKEND`) and the frontend (`STOREBOK_FRONTEND`); this backlog is the same file in both. If they disagree, this backlog wins and the plan is corrected.

1. **Acceptance criteria:** the original criteria, expanded into a full, production-ready Given / When / Then list.
2. **Stories and points:** the criteria split into buildable stories, each with points, priority, dependencies, and the criteria it covers.
3. **Product owner decisions:** every open question, with a recommendation and the reason.
4. **Developer review:** estimates, missing stories, dependencies, and effects on other epics.

**Priorities:** **Must have** (needed for the first release to test shops), **Should have** (soon after), **Could have** (later, once there's evidence it's needed).

**Points:** Fibonacci (1, 2, 3, 5, 8, 13), relative to a baseline: **2 points = a small, well-understood change** (for example, adding one validated field to a form and the server). Anything over 8 is split.

## Definition of Done (every story)

- Works **fully offline**; the change syncs correctly when the phone reconnects, without duplicates.
- **Business data is private:** every server query is limited to the signed-in user's business, and role rules are checked **on the server**, not only hidden on screen.
- **Money is stored in whole pesewas** (never decimals); amounts show as "GH₵ 120.00".
- Every screen works on a **small Android phone** (360px wide), with buttons at least 48px and text readable outdoors.
- Every screen and message is available in **English and Twi**.
- Important actions record **who did it and when**; nothing is silently deleted.
- Validated on the server with clear error messages; no secrets in logs.
- **Money and stock stay consistent:** for any story that touches money or stock, the consistency checks (balances, stock, receipts, sequences, operations) report nothing wrong after its tests, and its concurrency cases pass on a real MySQL database.
- **Every business request is signed** by the phone's own key, and the server checks it (F16).
- Tested by the developer (automated tests that were actually run, with results reported), then tried in the **test shop** before it's called done. Anything that needs production is checked by me after I deploy.

---

# Part 1: User stories (stage 1)

A bookkeeping app for **market traders and shops of all kinds**. Any business can sign up and keep its own private records. It's designed first around a **clothing, fabric and shoe shop** in a large market (the first test shop), run by an **owner** with a **manager** and a **sales associate**, who today keep a notebook, and then tested with **neighbouring shops** in the same market. Some businesses have **more than one shop or a warehouse**. Customers pay with **cash**, **mobile money**, or **on credit**. Phones are **Android smartphones with data on and off**, so the app must work fully **offline** and **sync** whenever there's a connection. Screens in **English and Twi**.

**Stage 1 goal:** replace the notebook, and let the owner see everything that happens in the shop, even when she isn't there. If recording a sale takes longer than writing one line, it has failed.

Each story below will go through the four planning steps (acceptance criteria, stories and points, decisions, developer review) before it's built.


### Epic 1: Products, sizes and prices

1. **Add a product.** As a shop owner, I want to add a product by name (no photo needed), so that adding products is quick and everyone recognises them.
2. **Sizes.** As a shop owner, I want to give a product its sizes, choosing a size range (shoe sizes such as 30–40, clothing sizes S–XXL) or no sizes, so that I don't have to type each size.
3. **Fabrics.** As a shop owner, I want to add a fabric by its design name (no sizes), sold by the piece or by the yard, so that fabric stock and prices match how I sell it.
4. **Any kind of product.** As a shop owner who sells something else (for example, provisions or phones), I want products without sizes, sold by the piece or another unit, so that the app works for my shop too.
5. **Three prices.** As a shop owner, I want each product to have a cost price (what I paid), a wholesale price, and a retail price, so that sales are quick and my profit is accurate.
6. **Cost price is private.** As a shop owner, I want only me to see cost prices and profit, so that my staff see selling prices but not my margins.
7. **Find a product fast.** As a seller, I want to search products by typing part of the name, so that I can find one among many in seconds.
8. **Edit and hide products.** As a shop owner, I want to change a product's details or prices, or hide one I no longer sell, so that the list stays correct without losing past sales.

### Epic 2: Stock

9. **Add new stock.** As a shop owner or manager, I want to record goods that arrive, with a quantity for each size, so that the stock stays correct.
10. **Remove stock.** As a shop owner or manager, I want to remove items that were damaged, lost, or returned to a supplier, with a reason, so that the stock matches the shelf.
11. **See what's left.** As anyone in the shop, I want to see every product with its quantity for each size, so that I can answer customers ("Do you have size 42?").
12. **Low-stock warning.** As a shop owner, I want a warning when a size is running low, so that I can restock before I lose sales.

### Epic 3: Sales

13. **Record a sale quickly.** As a seller, I want to pick the product, size, and quantity in a few taps, so that recording a sale is faster than the notebook.
14. **Retail or wholesale.** As a seller, I want to choose retail or wholesale for each sale, so that the right price is filled in automatically.
15. **Price changes need a note.** As a shop owner, I want any sale at a different price from the set retail or wholesale price (after bargaining or a mistake) to require a written note from the seller, so that I know why the price changed.
16. **How it was paid.** As a seller, I want to mark each sale as cash, mobile money, credit, or part-paid (some now, the rest on credit), so that money and debts are recorded correctly.
17. **Confirm before saving.** As a seller, I want to see the item, size, quantity, price, and payment before I confirm a sale, so that I catch mistakes before they're recorded.
18. **Sales are permanent.** As a shop owner, I want a confirmed sale to be impossible to undo, edit, or delete by anyone, so that the records can always be trusted.
19. **Correct a mistake with a new record.** As a seller, I want to fix a wrong sale by recording a correction (a return or an exchange, with a reason), so that the stock and money become right while the original sale stays visible.
20. **Exchange an item.** As a seller, I want to record an exchange (for example, size 40 swapped for size 41, or one product for another), so that the returned item goes back into stock, the new one comes out, and any price difference is recorded as money paid or given back.
21. **Return an item.** As a seller, I want to record a returned item and how the money was given back (cash, mobile money, or taken off the customer's debt), so that stock, money, and debts stay correct.

### Epic 4: Customers and debts

22. **Customers.** As a seller, I want to save a customer's name and phone number, so that I can record what they owe.
23. **Sell on credit.** As a seller, I want a credit sale to be added to that customer's balance, so that the shop never forgets who owes.
24. **Record a repayment.** As a shop owner or manager, I want to record a full or partial repayment, so that it's deducted from the customer's balance.
25. **Credit limit.** As a shop owner, I want to set how much each customer may owe, so that the app warns the seller before a credit sale goes over the limit.
26. **Who owes me.** As a shop owner, I want a list of everyone who owes, with the amount and how long they've owed it, so that I know whom to follow up.
27. **Customer history.** As a shop owner, I want to see each customer's purchases and repayments, and who recorded each one, so that I can settle any disagreement.

### Epic 5: Keeping customers informed

28. **Send a statement.** As a shop owner or manager, I want to send a customer their balance and history by WhatsApp or SMS, so that they can see what they owe.
29. **Repayment receipt.** As a shop owner or manager, I want to send a receipt after each repayment ("Received GH₵ 50. Balance: GH₵ 150."), so that the customer and the shop have the same record.
30. **Weekly reminders.** As a shop owner, I want customers who still owe a week after buying to appear in a "Remind today" list, and again every week until they've paid, with a polite reminder ready to send, so that debts are followed up on time.
31. **Customer's language.** As a shop owner, I want to choose English or Twi for each customer's messages, so that every customer understands them.

### Epic 6: Daily summary

32. **Today's summary (owner).** As a shop owner, I want to see today's sales, cash received, mobile money received, credit given, debts collected, and profit, so that I know how the day went.
33. **Check the money.** As anyone closing the shop, I want the cash and mobile money totals separately, so that we can check them against the till and the MoMo balance.
34. **By person.** As a shop owner, I want to see each day's sales by who recorded them, so that I know what happened while I was away.
35. **Price changes to review.** As a shop owner, I want to see every sale whose price was changed, with its note and who made it, so that I can check them quickly.
36. **Past days.** As a shop owner, I want to look back at any previous day, so that I can compare and find mistakes.

### Epic 6b: Expenses

37. **Add an expense.** As a shop owner or manager, I want to record a daily expense (for example, market levy, transport, porters, food) with an amount, a reason, and whether it was paid in cash or mobile money, so that the day's profit and money are honest.
38. **Expenses in the summary.** As a shop owner, I want the daily summary to subtract expenses from profit and from the expected cash and MoMo totals, so that the till check matches reality.
39. **Common expenses.** As a shop owner, I want to pick from my usual expenses instead of typing them each time, so that recording one takes seconds.

### Epic 7: The shop team

40. **Sign up my business.** As any shop owner in the market, I want to sign up my business and sign in, so that my records belong to my business and are kept safely online.
41. **Private records.** As a shop owner, I want no other business, including my neighbours, to ever see my products, prices, customers, or sales, so that I can trust the app with my business.
42. **Quick setup.** As a new shop owner, I want to choose what I sell (for example, clothing, shoes, fabric, or other goods) so the right size ranges and units are ready, so that I can start selling within minutes without help.
43. **Add my team.** As a shop owner, I want to add staff and give each a role (manager or sales associate), so that they can use the app on their own phones.
44. **Roles.** As a shop owner, I want each role to do and see only what I allow (see the roles table), so that the business stays under my control.
45. **Remove someone.** As a shop owner, I want to remove a staff member's access, so that someone who leaves can no longer see or change the records.
46. **Who did what.** As a shop owner, I want every sale, price change, stock change, repayment, and correction to show who recorded it and when, so that I can trust the records.

### Epic 8: Offline, sync and safety

47. **Works offline.** As anyone in the shop, I want everything to work with no internet, so that we can use it all day in the market.
48. **Syncs automatically.** As a shop owner, I want everyone's records to sync whenever their phone has data, so that I see the shop's sales from wherever I am.
49. **Sync status.** As a seller, I want to see whether my records have been sent yet, so that I know the owner can see them.
50. **Same item sold twice.** As a shop owner, I want a warning when two people sold the same last items while offline (stock below zero), so that I can check the shelf instead of losing a sale.
51. **Lock the app.** As anyone in the shop, I want to protect the app with a PIN, so that nobody who picks up my phone can see or change the records.

### Epic 9: Language

52. **English or Twi.** As anyone in the shop, I want to use the app in English or Twi, so that everyone on the team understands it.

### Epic 10: Accounts, privacy and support (added 1 Nov 2026)

53. **Email and phone number.** As a shop owner, I want to sign up with my phone number and my email, and sign in with either, so that I can always get back into my account.
54. **Forgot my password.** As anyone with an account, I want to reset a forgotten password from my email, or ask the owner to reset it, so that one forgotten password never locks a business out.
55. **Debts from the notebook.** As a shop owner, I want to enter what customers already owed before we started using the app, so that their balances are right from day one.
56. **My records, my choice.** As a shop owner, I want to download my records and to close my business's account with everything deleted, so that I stay in control of my data and my customers' data.
57. **Practice first.** As a new staff member, I want to practise selling in a practice shop, so that my training sales never end up in the real records.
58. **Get help.** As anyone in the shop, I want to report a problem in one tap, with the details the developer needs, so that it gets fixed quickly.
59. **Change my details.** As anyone with an account, I want to change my phone number or email when they change, so that I can still sign in.


### Roles

| Can… | Owner | Manager | Sales associate |
|---|---|---|---|
| Record sales, credit sales, and customers | ✅ | ✅ | ✅ |
| Change a sale's price (with a note) | ✅ | ✅ | ✅ |
| See selling prices (retail and wholesale) | ✅ | ✅ | ✅ |
| See their own sales and today's totals | ✅ | ✅ | ✅ |
| See **cost prices and profit** | ✅ | ❌ | ❌ |
| Record repayments (with a receipt to the customer) | ✅ | ✅ | ✅ |
| Add or remove stock (sales take stock off automatically) | ✅ | ✅ | ❌ |
| Record a correction (return or exchange, with a reason) | ✅ | ✅ | ✅ |
| Undo, edit, or delete a confirmed sale | ❌ | ❌ | ❌ |
| Add products, set selling prices, hide products | ✅ | ✅ | ❌ |
| See everyone's sales and the full daily summary | ✅ | ✅ (no profit) | ❌ |
| Send a customer's balance and repayment receipts | ✅ | ✅ | ✅ |
| Send full statements; see the weekly reminders list | ✅ | ✅ | ❌ |
| Add or remove staff, manage shops | ✅ | ❌ | ❌ |

**Team size depends on the location:** a shop usually has an owner and a manager; a warehouse may add a sales associate. Any business can have any number of staff in each role.


### Decided so far

- **Products have a name and, if needed, a size range** (for example, 30–40 or S–XXL); stock is kept **per size**. No photos.
- **Every product has a cost price, a wholesale price, and a retail price.** Only the owner sees cost prices and profit.
- **Any sale at a price different from the set price needs a written note**, shown to the owner.
- **Credit reminders start a week after the sale and repeat weekly** until paid. In stage 1, the app prepares each reminder and the shop sends it by WhatsApp or SMS with one tap (sending fully automatically would cost money per SMS, so it's for a later stage).
- **Screens and customer messages in English and Twi.**
- **Sizes can have different prices** (for example, larger sizes cost more).
- **Returns and exchanges, daily expenses, and per-customer credit limits are in stage 1.**
- **Stock goes down automatically when a sale is recorded;** at closing, the **manager closes the day** (checks sales, money, and a few shelves, and records any difference with a reason).
- **Every staff member, including each sales associate, uses their own phone and their own sign-in**, with a role set by the owner. Phones aren't shared, so every record is automatically under the right name.
- **Records sync automatically whenever a phone has data**; everything works offline in between. The online copy is also the backup, and the server's database has its own encrypted backups (server plan, Backups and restore).
- **A confirmed sale can never be undone, edited, or deleted, by anyone (including the owner).** Sales are checked on a confirmation screen first; mistakes are fixed with a visible correction (a return or exchange, with a reason), and the original sale stays in the records.
- **Nothing is ever silently deleted:** corrections and changes keep a record of who made them and why.
- **For any business, not one shop:** each business signs up and its records are completely private to it. The clothing, fabric and shoe shop is the first test shop, followed by neighbouring shops in the same market.
- **Fabrics are named by their design** (no sizes) and sold by the piece or the yard; other goods can use any unit.
- **Built for more than one location from the start** (see stage 2), even though stage 1 is used in one shop per business.
- **Sign in with a phone number or an email**, plus a password; a forgotten password is reset by email, or by the owner for staff (Decisions F-3, F-18). Added 1 Nov 2026.
- **Debts from the notebook** are entered as "debts brought forward" when a shop starts (Decision 4-8).
- **Returns are settled exactly:** debt on that sale first, then money back only up to what was paid (Decision 3-10).
- **A practice shop** for training, so practice sales never mix with real ones (Decision F-24).
- **The owner can download her records and close her business** (Decisions F-22, F-23).

### Still to decide

1. ✅ **Decided:** the roles table is complete (Decision F-17).
2. ✅ **Decided:** the manager adds products and quantities; the owner fills in cost prices (a "Cost price needed" list).
3. ✅ **Decided:** any price with a note; a warning below wholesale; "Sold below cost" flagged for the owner (Decision 3-1).
4. **Twi translations:** who will check the Twi wording (for example, your mom or a family member)?
5. ✅ **Decided:** fabric can be sold by the piece or by the yard, with **half yards** allowed.
6. **Test shops:** which 3–5 neighbouring shops could try the app after your mom's, and what do they sell?
7. ✅ **Decided:** records arriving after closing (Decision F-16).

### Later stages (not stage 1)

- **Stage 2:** manager approval for corrections recorded by sales associates; more locations (a second shop, a warehouse), each with its own stock and staff; **moving stock between locations**; the owner viewing all locations or one at a time; a private, always-up-to-date link for each customer's statement; weekly and monthly reports; automatic SMS reminders.
- **Business side (alongside the stages):** how shops find and sign up for the app, whether it's free or paid (for example, free with a paid plan for more staff or locations), and support for shops that get stuck.
- **Stage 3:** records to show a lender (PDF export), matching mobile money payments, voice input, supplier credit (goods the business takes on credit).
- **Later (noted 1 Nov 2026):** handing a business to a new owner (for example, when the owner sells the shop or can't continue). Today a business has exactly one owner who can't be removed (Epic 0, AC11).

---

# Part 2: Planned epics

# Epic 0: Foundations

No codebase exists yet, so this epic sets up everything the user-facing epics depend on: the technology, the offline database, sync, accounts, the team, and deployment. From Part 1: Epics 7 (shop team) and 8 (offline, sync and safety), plus the technical groundwork.

## Step 1: Acceptance criteria

### Accounts

- **AC1: Sign up a business.** Given I'm a shop owner, when I enter my name, **phone number, email**, business name, a password, and my language, and accept the privacy notice and terms (AC37), then my business and owner account are created, and I'm signed in. (Changed 1 Nov 2026: email added, Decision F-3.)
- **AC2: Sign in with phone number or email.** Given I have an account, when I enter my phone number **or** my email, and my password, then I'm signed in; a wrong login or password shows the same message ("Wrong phone number, email or password."), so nobody can find out who has an account.
- **AC3: Phone numbers and emails.** Given I type a phone number, then it's accepted as a **Ghanaian mobile number** (`0XXXXXXXXX` or `+233XXXXXXXXX`) and saved as `+233…`; an email is trimmed and saved in lower case. Each phone number and each email belongs to only one account. The owner must give an email; staff may add one later (AC31).
- **AC4: Stay signed in offline.** Given I've signed in once, then I stay signed in for 30 days of use, even with no internet, and each sync extends it.
- **AC5: Strong enough passwords.** Given I choose a password, then it must have at least 8 characters; it's stored only as a hash.
- **AC6: Too many attempts.** Given someone tries wrong passwords repeatedly, then sign-in is slowed down (rate limited) for that phone number or email and that connection.

### The team

- **AC7: Add staff.** Given I'm the owner, when I add a staff member with their name, phone number, and role (manager or sales associate), then a temporary password is shown once for me to give them in person.
- **AC8: First sign-in.** Given a staff member signs in with a temporary password, then they must choose their own password before using the app.
- **AC9: Change a role.** Given I'm the owner, when I change someone's role, then their permissions change on their next sync, and the change is recorded.
- **AC10: Remove staff.** Given I'm the owner, when I remove a staff member, then their next sync is refused, the business's records are wiped from their phone, and nothing they recorded before is lost or changed.
- **AC11: One owner.** Given a business, then it has exactly one owner, who can't be removed or demoted (handing over ownership comes later).
- **AC12: Roles on the server.** Given any request, then the server checks the user's **current** role from the database (not from the phone), and refuses anything the role doesn't allow.

### Privacy between businesses

- **AC13: Business isolation.** Given I'm signed in to my business, then every record I can read or change belongs to my business; any attempt to reach another business's records is refused as "not found."
- **AC14: Field privacy.** Given I'm not the owner, then cost prices, profit, and anything calculated from them are **never sent to my phone**.

### Offline and sync

- **AC15: Works offline.** Given my phone has no data, then I can do everything my role allows; changes are saved on the phone straight away.
- **AC16: Sync whenever possible.** Given my phone has data, then my changes are sent and others' changes are received automatically (on opening the app, every few minutes while it's open, and right after I save something), without any button.
- **AC17: No duplicates.** Given a sync is interrupted and retried, then nothing is saved twice.
- **AC18: Permanent records sync safely.** Given sales, corrections, repayments, stock entries, and expenses can't be edited after they're saved, then they're only ever **added**, and two phones can never overwrite each other's records.
- **AC19: Editable records.** Given products, sizes, customers, and settings can be edited on two phones while offline, then the change received **last by the server** wins, and every version is kept in the change history.
- **AC20: Sync status.** Given I have changes not yet sent, then I see how many and when the last successful sync was; when everything is sent, I see "All records sent."
- **AC21: Rejected records.** Given the server refuses something I recorded offline (for example, I was removed, or a value was invalid), then I see a clear message about that record, and it isn't silently lost.
- **AC22: Phone clock.** Given a phone's clock is wrong, then each record keeps both the phone's time and the server's time, and records with a phone time far from the server time are flagged for the owner.
- **AC23: Storage kept.** Given the app is installed, then it asks the phone to keep its storage permanently, so Android doesn't clear it when space runs low.
- **AC24: New phone.** Given I sign in on a new phone, then all the records my role allows are downloaded, and I can carry on.

### App lock and language

- **AC25: PIN lock.** Given I've set a 4-digit PIN, then the app asks for it when opened and after 5 minutes in the background; after 5 wrong PINs, I must sign in with my password again (online).
- **AC26: Two languages.** Given my language is English or Twi, then every screen, button, message, and error is in that language, and I can switch at any time.

### Installing and running

- **AC27: Install.** Given I open the app's link in Chrome on Android, then I can add it to my home screen, and it opens like an app (its own window and icon).
- **AC28: Updates.** Given a new version is released, then the app updates itself the next time it's opened with data, without losing anything not yet synced.
- **AC29: Low data.** Given data is expensive, then a normal day's sync for one phone uses well under 1 MB.
- **AC30: Low-cost phones.** Given a low-cost Android phone (2 GB of memory), then the app opens in under 3 seconds and stays responsive with a year of records for a busy shop.

### Email, password recovery and account details (added 1 Nov 2026)

- **AC31: Staff emails.** Given the owner adds a staff member, then an email is optional; any staff member can add or change their own email later in Settings.
- **AC32: Confirm my email.** Given I've given an email, then I receive a link to confirm it. I can use the app straight away (it works offline), and Settings shows "Email not confirmed. Send the link again" until I do. The link works once and expires after 24 hours.
- **AC33: Forgot password (email).** Given I've forgotten my password and my email is confirmed, when I tap **Forgot password** and enter my phone number or email, then a reset link is emailed to me. The screen always says "If that account has a confirmed email, we've sent a link", whether or not it exists. The link works once, expires after 30 minutes, and setting a new password signs me out on every other phone.
- **AC34: Forgot password (no email).** Given a staff member has no confirmed email, when they forget their password, then the owner taps **Reset password** on their team page and gets a new temporary password to give them in person (as in AC7); their other sign-ins end.
- **AC35: Owner locked out.** Given the owner can't reach her email either, then the developer can reset her password with a support tool, only after confirming who she is in person or by phone, and the reset is recorded (AC44).
- **AC36: Change my phone number or email.** Given I'm signed in, when I change my phone number or email in Settings, then I must enter my current password; the new one must not belong to another account; a new email must be confirmed (AC32), and a notice goes to the old email; my other sign-ins end.

### Privacy and the owner's data

- **AC37: Privacy notice and terms.** Given I sign up, then I must tick "I accept the privacy notice and terms", with links to read both, in English and Twi. The version and time I accepted are recorded. When the owner adds staff, they accept them at their first sign-in.
- **AC38: Download my records.** Given I'm the owner and online, then I can download my business's records as CSV files that open in Excel: products and stock, customers and balances, sales (for chosen dates), repayments, and expenses.
- **AC39: Close my business.** Given I'm the owner, when I choose **Close my business**, enter my password and type the business name, then staff access ends straight away, the business is closed, and all its records are **permanently deleted after 30 days**. Until then I can cancel. I'm shown the download (AC38) first. This is the one case where permanent records are deleted, because the business itself asked.

### Practice, help and support

- **AC40: Practice shop.** Given I'm anyone on the team, when I switch to **Practice** in More, then I use a separate practice shop with sample products and customers. Every screen shows a "PRACTICE" bar, nothing I do there touches the real records or figures, and the owner can reset the practice shop.
- **AC41: Report a problem.** Given something isn't working, when I tap **Help → Report a problem**, then WhatsApp opens to the developer's number with a message ready, holding the app version, my phone's device code, how many records are waiting, and the last error code and reference. It never includes customer names, amounts or passwords.
- **AC42: Errors reach the developer.** Given the server has an unexpected error, then the developer is alerted through error monitoring, without personal data.
- **AC43: Support tools.** Given the developer needs to help a shop, then support tools, run from the developer's laptop and never from the app, can find a business by phone number or email, reset an owner's password (AC35), and count businesses and phones.
- **AC44: Support is recorded.** Given the developer uses a support tool that changes something, then the action, the reason, who did it and when are recorded.

## Step 2: Stories and points

| Story | Title | Points | Priority | Covers |
|---|---|---|---|---|
| F1 | Project setup (backend, frontend, database, deployment pipeline) | 5 | Must have | Groundwork |
| F2 | Sign up a business and sign in by phone number or email | 5 | Must have | AC1–AC6, AC37 |
| F3 | Team: add, change, and remove staff; first-sign-in password; owner resets a staff password | 5 | Must have | AC7–AC11, AC34 |
| F4 | Business isolation and role checks on every request | 5 | Must have | AC12–AC14 |
| F5a | Sync: server endpoints, change sequence, permanent vs editable records | 8 | Must have | AC17–AC19, AC22 |
| F5b | Sync: phone side (local database, outbox, retries, background sync) | 8 | Must have | AC15, AC16, AC21 |
| F6 | Sync status, rejected records, removed-user wipe, new phone | 5 | Must have | AC10, AC20, AC21, AC24 |
| F7 | Installable app, offline start, updates, persistent storage | 5 | Must have | AC23, AC27, AC28 |
| F8 | PIN lock and English/Twi language framework | 5 | Must have | AC25, AC26 |
| F9 | Performance and data-use checks on a low-cost phone (gap story) | 3 | Must have | AC29, AC30 |
| F10 | Confirm email, forgot password by email, change phone number or email | 5 | Must have | AC31–AC33, AC36 |
| F11 | Support tools, support log, error monitoring | 3 | Must have | AC35, AC42–AC44 |
| F12 | Download my records (CSV) | 3 | Must have | AC38 |
| F13 | Close my business (30-day grace, then delete) | 3 | Should have | AC39 |
| F14 | Practice shop | 5 | Should have | AC40 |
| F15 | Help: report a problem on WhatsApp | 2 | Should have | AC41 |
| F16 | Device signing keys: enrol with password and proof of key, sign every business request (gap story) | 5 | Must have | F-26 |
| F17 | Concurrency safety: one lock order, deadlock retries, database constraints, consistency checks, concurrency and recovery tests (gap story) | 5 | Must have | AC17, AC18 (under real simultaneous use) |

**Epic 0 total:** 18 stories, **85 points** (Must have: 75; Should have: 10). (The sync engine, first estimated at 13, was split into F5a and F5b; see Step 4. F10–F15 added on 1 Nov 2026; F16–F17 added after the engineering reviews the same day.)

## Step 3: Product owner decisions

| # | Question | Decision | Why | Alternatives considered |
|---|---|---|---|---|
| F-1 | What kind of app? | **An installable web app (PWA)** in React, used on Android phones. | Reuses what was learned building Adorn; no Play Store; instant updates; installs from a link. | Android app with React Native. |
| F-2 | Backend stack? | **Express, Sequelize, MySQL**, deployed like Adorn (Render, Aiven, Vercel with an `/api` rewrite). Updated 1 Nov 2026 to match Agyefam: **Node 26, Express 5, argon2id, Jest + Supertest**, email through **Brevo's HTTPS API**, errors to **Sentry**; the full list is in each plan's "Stack" and in the backend's and frontend's `CLAUDE.md`. | Known stack and deployment; proven with Adorn and Agyefam. | PostgreSQL; a hosted backend service. |
| F-3 | How do people sign in? | **Phone number or email, plus a password** (changed 1 Nov 2026). Sign-up asks for both a phone number and an email; the **owner must give an email**, staff may add one later. A 4-digit PIN only unlocks the app on the phone. | With only a phone number and password, an owner who forgot her password would lose her whole business; a confirmed email lets anyone reset it for free. Most Android users already have a Gmail address. | Phone number only (no way to recover a password); SMS codes (cost money per SMS); email only (some staff have none). |
| F-4 | How do staff get accounts? | **The owner adds them** (name, phone number, role; email optional) and gives a temporary password in person; staff choose their own at first sign-in. | No email or SMS needed to start; the owner stays in control. | Invite links by SMS or WhatsApp (later). |
| F-5 | How long does a sign-in last? | **30 days of inactivity, extended by each sync, with an absolute maximum of 90 days.** When it ends, the phone keeps every record and unsent operation; the person keeps selling offline and signs in again when there's data. | Staff must keep working offline for days without signing in again; the 90-day limit stops a lost phone staying signed in forever. | Short sessions (like Adorn's 1 day) would lock people out offline; no maximum at all. |
| F-6 | How does sync work? | **Records are created on the phone with their own IDs. Permanent records (sales, corrections, repayments, stock entries, expenses, day closes) are only ever added. Editable records (products, sizes, customers, settings) use "last change received by the server wins," with full history.** | Sales are permanent by rule, so most data can never conflict; the rare product edits keep history. | Merging edits field by field; locking records while editing (impossible offline). |
| F-7 | How is stock stored? | **As a list of stock movements** (starting stock, restocks, sales, returns, exchanges, removals, adjustments); the quantity on hand is their total. | Offline phones can each add movements without conflicts; every change is traceable. | A single number per size (two offline phones would overwrite each other). |
| F-8 | What if two phones sell the last item offline? | **Both sales are kept;** stock goes below zero and is flagged for the owner and manager. | Both sales really happened; refusing one would make the records wrong. | Refuse the second sale on sync. |
| F-9 | What do staff phones receive? | **Owner:** everything. **Manager:** everything except cost prices and profit. **Sales associate:** products, selling prices, stock, customers and their balances, and **their own** sales, corrections, and repayments. | Least access needed for each job; keeps phones' storage small. | Everyone receives everything and screens hide parts. |
| F-10 | Whose clock decides the date of a record? | **The phone's time when recorded** (sales happen when the phone says), with the server's time kept too; differences over 10 minutes are flagged. | Offline records must keep the time they really happened. | Server time only (offline sales would get the wrong day). |
| F-11 | Removed staff and their phones? | **Next sync refuses them and wipes the business's records from that phone;** what they recorded before stays. | Protects the business when someone leaves. | Leave the data on the phone. |
| F-13 | How are receipt numbers made? | **On the phone:** the phone's device code and its own counter (for example `K7M-0042`), shared by sales, corrections, and repayments. Numbers only go up and are never reused; a reinstalled phone gets a new device code. | Receipts must work offline; numbers made by the server would need the network. | Server-made numbers (no receipt offline); random codes (hard to read out). |
| F-14 | Lost or stolen phones? | **The owner sees every phone (name, person, last seen) and can revoke one.** Its next sync is refused and its records are wiped; the person can sign in on a new phone. | Protects the business's records without removing the person. | Only removing the whole staff member. |
| F-15 | A wrong expense? | **Fixed with a new expense record that points to the original, with a reason.** The original never changes. | Same rule as sales: nothing permanent is edited. | Editing expenses. |
| F-16 | Records that arrive after the day is closed? | **They count on the day they were recorded.** The close isn't changed; the closed day shows "N records arrived after closing" with their totals by cash and MoMo, and shows whether they **explain the close's difference** (a late cash sale's money was already in the drawer when it was counted). | Offline phones can send a day's sales late; the records must stay on their real day. | Moving them to the next day; reopening the closed day. |
| F-17 | What can sales associates do with debts, stock, and statements? | **Record repayments** (both managers and associates take customers' money), always with a WhatsApp or SMS receipt to the customer. **No adding or removing stock.** **Send a customer's balance and repayment receipts, but not full statements or the reminders list.** | Customers pay whoever is at the stall; an unrecorded payment is worse than a recorded one, and the receipt, Today's "by person" figures, and the day close check it. Removing stock is where losses can hide. Associates only hold their own sales, so a full statement on their phone would be incomplete. | Associates can't take repayments; associates manage stock too. |
| F-12 | Free hosting? | **Free plans for testing** (Render, Aiven, Vercel); a paid server before shops rely on it daily. | Free servers sleep, which only delays sync (the app works offline), but a real business needs reliability. | Paid from day one. |
| F-18 | Forgotten passwords? | **A reset link to the confirmed email** (once, 30 minutes). Staff with no email: **the owner resets** to a temporary password. An owner with no access to her email: **the developer resets it with a support tool** after confirming who she is in person or by phone. Every reset signs out the person's other phones. | Nobody is ever locked out for good, at no cost; the owner stays in control of her staff. | SMS codes (cost money); recovery codes on paper (easily lost); no recovery. |
| F-19 | Must the email be confirmed before using the app? | **No.** The app works straight away; Settings asks to confirm it. Reset links only go to a **confirmed** email. | The app must work offline from the first minute; an unconfirmed email could be someone else's address. | Block the app until confirmed. |
| F-20 | How are emails sent? | **Through an email provider's HTTPS API** (Brevo free plan, about 300 a day), never SMTP (blocked on free hosting). Only account emails: confirm email, reset password, email changed, business closing. Sent after the database change is saved; if sending fails, the person taps "Send again". | Free, works on free hosting, and proven on Adorn and Agyefam. | SMS (costs money); SMTP (blocked). |
| F-21 | Privacy? | **A short privacy notice and terms, accepted at sign-up** (version and time recorded). Customers' details are used only for the shop's own records and messages the shop sends itself. Ghana's Data Protection Act applies: the owner can download (F-22) and delete (F-23) her business's records. | The app stores other people's names, phone numbers and debts; owners must know how they're used and stay in control. | No notice. |
| F-22 | Can the owner take her records out? | **Yes: CSV files** for products and stock, customers and balances, sales, repayments and expenses. Owner only, online. | Her records are hers; CSV opens in Excel and needs no extra library. | PDF (stage 3, for lenders). |
| F-23 | Closing a business? | **The owner asks in the app** (password plus typing the business name). Staff access ends at once; **all records are deleted 30 days later**, and she can cancel until then. | The owner's right to delete her data, with time to change her mind. The only exception to "permanent records are never deleted", because the whole business asked. | Delete at once (no undo); never delete. |
| F-24 | Training new staff? | **A practice shop** for every business, with sample products and customers, a "PRACTICE" bar on every screen, and a reset by the owner. | Sales can never be deleted, so training in the real shop would leave fake sales in the records forever. | Train on paper; a "training flag" on real records (mixes fake and real). |
| F-26 | How does the server know which phone is really talking? (added 1 Nov 2026) | **Each phone makes its own signing key** when it registers (kept on the phone and impossible to copy out), and signs every request. **Registering a phone needs the person's password** and proof that the phone holds its key, so a copied sign-in cookie can't add a new phone; the owner is told by email whenever a phone is added; the server checks the signature, the time (using the server's clock, so wrong phone clocks still work) and a one-time number. | A phone's ID is just a label: anyone with a copied sign-in cookie could claim it. The key means a copied cookie is useless on another machine. It doesn't protect against harmful code inside the app itself, so the app also blocks outside scripts. | Trust the device ID (easy to fake); signing without clock correction (would fail on phones with the wrong time). |
| F-25 | Help and support? | **Help → Report a problem** opens WhatsApp to the developer with technical details only (app version, device code, waiting records, last error reference). Server errors go to error monitoring (Sentry free) without personal data. **Support tools** run from the developer's laptop, never as routes in the app, and every change they make is logged. | Shops in the market will say "it's not working"; the developer needs details without seeing their records. Keeping support tools off the internet means they can't be attacked. | An in-app admin area (a target for attackers); no support channel. |

## Step 4: Developer review

| Story | Before | After | Reason |
|---|---|---|---|
| F5 | 13 | F5a 8 + F5b 8 | Too big for one story; the server and phone sides are separate pieces of work. The phone side is the hardest part of the project. |
| F9 | — | 3 | Gap story: performance on low-cost phones and data use need explicit tests. |
| F5a, F5b | 8 + 8 | 8 + 8 | No change in points, but each now ends with a **torture test** (BE5.5 on the server, FE3.5 with two phones) that must pass before any feature epic starts. |
| F2, F3 | 5 + 5 | 5 + 5 | Email at sign-up and sign-in, terms acceptance and the owner's staff reset fit in the same tasks. |
| F10 | — | 5 | Gap story: without a way to recover a password, one forgotten password locks a business out. Needs the email adapter, one-time tokens and rate limits. |
| F11 | — | 3 | Gap story: the developer needs a safe way to help shops and to hear about errors. |
| F12, F13 | — | 3 + 3 | Gap stories: data protection (the owner's right to her records and to delete them). |
| F14 | — | 5 | Gap story: training without polluting permanent records. The practice shop is a second business, so the phone must keep each business's records separately. |
| F15 | — | 2 | Gap story: a support channel for test shops. |
| F16 | — | 5 | Gap story from the engineering reviews: a device ID isn't proof; keys, challenges, nonces and clock correction are real work on both server and phone. |
| F17 | — | 5 | Gap story from the engineering reviews: sync tests with repeated requests aren't enough; simultaneous transactions need their own design and tests. |

**Changes from the engineering reviews (1 Nov 2026):** three outside reviews of the server plan led to these decisions (details and reasons in the server plan's ADR-14 to ADR-26):

- **Kept:** receipt numbers made on the phone, now checked by one receipt registry (server-made numbers rejected: receipts must work offline).
- **Added:** device signing keys (F16, F-26); one global lock order, deadlock retries, `CHECK` constraints, five read-only consistency checks, concurrency and recovery tests (F17); composite foreign keys between business tables; `OP_ID_CONFLICT` (a per-operation rejection, not an HTTP 409); pulls with a watermark.
- **Epic 1:** prices and cost kept per version, so offline sales are checked against the price the phone really showed (Story 1.10).
- **Epic 2:** a stock count records what was on the shelf and becomes the starting point (Story 2.9, Decision 2-5 clarified).
- **Epic 3:** exact rules for settling a return or exchange (Story 3.13, Decision 3-10, AC30 changed).
- **Epic 4:** debt lots and credit lots with an arrival-independent order (Story 4.13); full, once-only reversals, including write-offs (Story 4.14, Decision 4-9, AC23b).

**Effects of the 1 Nov 2026 additions:**

- **F2, F3 and F10 come before sync:** they change the `User` table (email, confirmed email, terms) and add one-time tokens, so they're built in BE2 and BE3.
- **F14 (practice shop):** a user can belong to two businesses (the real one and its practice shop), so the phone keeps **one local database per business** and every sync request names the business. This is set up in the sync engine (F5a, F5b) even though the practice shop itself is built later.
- **Epic 4:** gains debts brought forward (Story 4.12), which change the balance formula and the debt's age.

**Dependencies and effects on other epics:**

- **Every other epic depends on F1–F6.** Build order: F1, F2, F3, F4, F5a, F5b, F6, F7, F8, F9.
- **Epic 1 (Products):** cost prices are filtered by role in F5a's pull (AC14, Decision F-9).
- **Epic 2 (Stock):** built on stock movements (Decision F-7), including half-yard units.
- **Epic 3 (Sales):** sales are permanent records (F-6); the server recalculates every total from the items and never trusts a total sent by the phone.
- **Epic 4 (Debts):** a customer's balance is calculated from sales on credit, corrections, and repayments, never stored as a number that phones edit.
- **Risk:** sync is the hardest and most important part. Build and test it (including airplane-mode tests with two phones) before the user-facing epics.

---

# Epic 1: Products, sizes and prices

From Part 1, Epic 1.

## Step 1: Acceptance criteria

**Original intent (from the user stories):** add a product by name, with no photo; give it sizes from a range (30–40, S–XXL) or none; fabrics by design name, sold by the piece or yard; other goods in any unit; a cost, wholesale, and retail price; only the owner sees cost prices and profit; find products fast by typing; edit or hide products.

### Adding a product

- **AC1: Add a product.** Given I'm the owner, when I enter a name, choose a type (clothing, shoes, fabric, or other), a unit, and its prices, and save, then the product appears in my product list straight away, even with no internet.
- **AC2: Name required.** Given I'm adding a product, when the name is empty or only spaces, then it isn't saved and I see "Enter a product name."
- **AC3: Name length.** Given I'm adding a product, when the name is longer than 80 characters, then it isn't saved and I see "Use a shorter name (up to 80 characters)."
- **AC4: Duplicate name.** Given my business already has a product called "Black sandal", when I add another "black sandal" (any capitals or extra spaces), then I'm warned "You already have a product with this name" and can change it or open the existing one.
- **AC5: Starting stock.** Given I'm adding a product, when I enter a starting quantity (for each size, if it has sizes), then that stock is recorded as the product's first stock entry, with my name and the date.
- **AC6: Business only.** Given I add a product, then it belongs only to my business, and no other business can ever see it.

### Sizes

- **AC7: Size range.** Given I'm adding a clothing or shoe product, when I choose a ready-made range (for example, shoes 30 to 40, or clothing S to XXL) and the first and last size, then every size in between is created, each with its own quantity.
- **AC8: Custom sizes.** Given a product whose sizes aren't in a ready-made range, when I type my own sizes separated by commas (for example, "1Y, 2Y, 3Y"), then each becomes a size with its own quantity.
- **AC9: No sizes.** Given a fabric or other product, when I choose "No sizes", then the product has a single quantity.
- **AC10: Add a size later.** Given a product with sizes, when I add a new size, then it's added with quantity 0 (or the quantity I enter as new stock).
- **AC11: Remove a size.** Given a size with quantity 0, when I remove it, then it no longer appears for sale; given a size that still has stock, then I can't remove it and see "This size still has X in stock."
- **AC12: Size order.** Given a product with sizes, then sizes always show in their natural order (30, 31 … 40; S, M, L, XL, XXL), never alphabetically.

### Fabrics and units

- **AC13: Fabric.** Given I choose the type "Fabric", when I enter the design name, then the product has no sizes and I choose whether it's sold by the **piece** or by the **yard**.
- **AC14: Other units.** Given I choose the type "Other", then I can choose a unit (piece, pair, set, dozen, yard, or my own word), and the unit shows next to every quantity ("12 pieces", "3 yards").
- **AC15: Quantities.** Given any product, then quantities are from 0 to 100,000; products sold by the **yard** also allow **half yards** (for example, 2.5 yards), and all other units use whole numbers. Any other fraction is refused with "Use whole or half yards (for example, 2.5)."

### Prices

- **AC16: Three prices.** Given I'm the owner or manager, when I add or edit a product, then I can enter a wholesale price and a retail price in GH₵ (and the owner also a cost price), each from GH₵ 0.01 to GH₵ 1,000,000.00, up to two decimal places.
- **AC17: Required prices.** Given I'm adding a product, then the retail price is required; the wholesale price is optional (if empty, wholesale sales use the retail price until one is set). The cost price is required when the **owner** adds a product; when the **manager** adds one, it's saved without a cost price and appears in the owner's **"Cost price needed"** list until she adds it.
- **AC18: Price warnings.** Given I enter prices, when the wholesale price is higher than the retail price, or a selling price is lower than the cost price, then I see a warning (not a block) and can save anyway.
- **AC19: Prices per size.** Given a product with sizes, then I enter the product's prices once, and they apply to every size; I can then **change the prices for individual sizes** (for example, size 42 to 46 cost GH₵ 20 more). Each size shows its own price wherever it's sold.
- **AC20: Cost is private.** Given I'm a manager or sales associate, then I never see cost prices or profit anywhere in the app, and **cost prices are never sent to my phone**, so they can't be found in the phone's storage.
- **AC21: Price changes don't rewrite history.** Given I change a product's price, then sales already recorded keep the price they were sold at, and only new sales use the new price.

### Finding products

- **AC22: Search.** Given I type part of a product name (for example, "sand"), then matching products appear as I type, ignoring capitals and spaces, even with no internet.
- **AC23: Fast with many products.** Given my business has 2,000 products, then search results appear in under half a second on a low-cost Android phone.
- **AC24: Browse by type.** Given I'm on the product list, then I can filter by type (clothing, shoes, fabric, other) and see each product's total stock.
- **AC25: Nothing found.** Given my search matches nothing, then I see "No products match '…'" and, for the owner, a button to add it as a new product.

### Editing and hiding

- **AC26: Edit.** Given I'm the owner, when I change a product's name, type details, unit, or prices and save, then the changes appear on every team member's phone after they sync.
- **AC27: Hide.** Given I'm the owner, when I hide a product, then it no longer appears in the list for selling, but past sales, debts, and reports still show it by name.
- **AC28: Show hidden.** Given I'm the owner, when I choose "Show hidden products", then I can see and un-hide them.
- **AC29: Never deleted.** Given a product has ever been sold or stocked, then it can't be deleted, only hidden.
- **AC30: Who changed it.** Given a product's prices or name are changed, then the change is recorded with who made it and when, and the owner can see the history.

### Permissions, offline and language

- **AC31: Who can change products.** Given I'm the **owner or manager**, then I can add, edit, and hide products and change selling prices (only the owner sees or sets cost prices). Given I'm a **sales associate**, then I can view and search products and their selling prices but not change them, and the server refuses it even if attempted.
- **AC34: Profit needs a cost price.** Given a product has no cost price yet, then sales of it still work, and the owner's profit figures show "Profit incomplete: X products need a cost price" instead of a wrong number.
- **AC32: Offline edits.** Given the owner adds or edits products while offline, then the changes are saved on the phone and sent automatically when there's data, and other phones receive them on their next sync.
- **AC33: Two languages.** Given my language is Twi, then product screens, buttons, units, size names, warnings, and messages are in Twi; product names stay exactly as typed.

## Step 2: Stories and points

### Story 1.1: Add a product (name, type, unit, starting stock)

**Points:** 5 | **Priority:** Must have | **Dependencies:** F-stories (Epic 0) | **Covers:** AC1–AC6, AC13–AC15

As a shop owner, I want to add a product by name with its type, unit, and starting stock, so that I can start selling it straight away.

**Technical notes:** product IDs are generated on the phone (UUIDs) so products created offline sync without clashes. Starting stock is written as a stock entry (Epic 2), not just a number on the product.

### Story 1.2: Sizes from ready-made ranges or custom lists

**Points:** 5 | **Priority:** Must have | **Dependencies:** 1.1 | **Covers:** AC7–AC9, AC12

As a shop owner, I want to choose a size range or type my own sizes, so that I don't have to add each size by hand.

**Technical notes:** ready-made ranges are stored as data (not code), so new ranges can be added later. Each size has a sort position for natural ordering.

### Story 1.3: Add or remove a size later

**Points:** 3 | **Priority:** Should have | **Dependencies:** 1.2 | **Covers:** AC10, AC11

As a shop owner, I want to add a size or remove an empty one, so that a product's sizes match what I really stock.

### Story 1.4: Product prices with warnings

**Points:** 3 | **Priority:** Must have | **Dependencies:** 1.1 | **Covers:** AC16–AC18, AC21

As a shop owner, I want to set cost, wholesale, and retail prices with sensible warnings, so that sales are quick and profit is accurate.

**Technical notes:** amounts in pesewas (integers). Sales store their own price (Epic 3), so price edits never change history.

### Story 1.4b: Different prices for some sizes

**Points:** 3 | **Priority:** Must have | **Dependencies:** 1.2, 1.4 | **Covers:** AC19

As a shop owner, I want to change the prices of individual sizes, so that larger sizes can cost more.

**Technical notes:** each size stores optional price overrides; empty means "use the product's price". The sale screen always shows the size's final price.

### Story 1.4c: Cost prices added later by the owner

**Points:** 2 | **Priority:** Must have | **Dependencies:** 1.4, 1.5 | **Covers:** AC17 (manager part), AC34

As a shop owner, I want a list of products the manager added without a cost price, so that I can complete them and keep my profit accurate.

### Story 1.5: Keep cost prices private

**Points:** 5 | **Priority:** Must have | **Dependencies:** 1.4, Epic 7 (roles) | **Covers:** AC20

As a shop owner, I want cost prices and profit visible only to me, so that my staff never see my margins.

**Technical notes:** the sync API must **leave out** cost fields for non-owners, not just hide them on screen; a separate test checks a staff phone's local database contains no cost prices.

### Story 1.6: Search and browse products offline

**Points:** 3 | **Priority:** Must have | **Dependencies:** 1.1 | **Covers:** AC22–AC25

As anyone in the shop, I want to find a product by typing part of its name or filtering by type, so that I can find it in seconds.

**Technical notes:** search runs on the phone's local database with a normalised name field (lowercase, single spaces); tested with 2,000 products on a low-cost phone.

### Story 1.7: Edit products and see their history

**Points:** 3 | **Priority:** Must have | **Dependencies:** 1.1, 1.4 | **Covers:** AC26, AC30, AC32

As a shop owner, I want to edit a product and see who changed what, so that my product list stays correct and trustworthy.

### Story 1.8: Hide and un-hide products

**Points:** 2 | **Priority:** Must have | **Dependencies:** 1.1 | **Covers:** AC27–AC29

As a shop owner, I want to hide products I no longer sell, so that the list stays tidy without losing history.

### Story 1.9: Product permissions and Twi wording (gap story)

**Points:** 3 | **Priority:** Must have | **Dependencies:** 1.1–1.8, Epic 7 | **Covers:** AC31, AC33

As a shop owner, I want only me and my manager to change products and selling prices, and everyone to see product screens in their language, so that the list stays under control and everyone understands it.

### Story 1.10: Prices and cost kept per version (gap story, added 1 Nov 2026)

**Points:** 3 | **Priority:** Must have | **Dependencies:** 1.4, 1.4b, F5a | **Covers:** Decision 3-8, Decision 3-1 (below cost)

As a shop owner, I want every sale checked against the price the seller's phone was actually showing, and its cost taken from that same moment, so that offline sales are priced and costed correctly even after I change a price.

**Acceptance:** every accepted product or size change keeps its prices and cost as a numbered version; a sale line names the version it used; the server checks the price against that version and sets the cost itself; a sale at an older price is saved and flagged "Older price used"; a phone can never send its own cost. **Technical notes:** `PriceVersion` (server plan, "Sale prices, older versions and cost", ADR-23).

**Epic 1 total:** 12 stories, **40 points** (Must have: 37; Should have: 3).

## Step 3: Product owner decisions

| # | Question | Decision | Why | Alternatives considered |
|---|---|---|---|---|
| 1 | Is a product's name unique? | **Yes, within a business** (ignoring capitals and extra spaces); different businesses can use the same names. | Sales and stock are picked by name, so two identical names cause mistakes at the counter. | Allow duplicates; unique across all businesses. |
| 2 | Do sizes have different prices? | **Yes, if needed:** prices are entered once for the product, and individual sizes can be changed. *(Changed by the product owner: larger sizes often cost more.)* | Fast to enter for most products, flexible for the rest. | One price for all sizes; separate prices for every size. |
| 3 | Who can add products and change prices? | **The owner and the manager** (second in command); **only the owner** sees and sets cost prices. Sales associates can't change products. *(Changed by the product owner.)* | The manager runs the shop day to day; cost prices stay private. | Owner only. |
| 4 | Is the cost price required? | **Yes, when the owner adds a product.** Products the manager adds wait in a "Cost price needed" list for the owner. | The owner knows every cost price, and the manager can't see them. | Optional cost price; manager enters cost. |
| 5 | Is the wholesale price required? | **No.** If empty, wholesale sales use the retail price until one is set. | Not every product is sold wholesale. | Required for every product. |
| 6 | Can quantities be fractions (for example, 2.5 yards)? | **Half yards, for products sold by the yard;** whole numbers for everything else. *(Changed by the product owner.)* | Fabric is sold in half yards. | Whole numbers only; any decimal. |
| 11 | How does stock go down when something is sold? | **Automatically, when the sale is recorded.** Sales can be entered later the same day if the shop is busy. At closing, the **manager closes the day**: reviews sales and price notes, checks cash and MoMo, spot-checks shelves, and records any difference as a stock adjustment with a reason. | One record per sale, no double work, and differences show up the same day. | The manager removes sold items by hand after the associate's list. |
| 7 | Do starting quantities count as stock entries? | **Yes**, recorded as the product's first stock entry. | Every quantity can then be traced to an entry with a person and a date. | Store a plain number on the product. |
| 8 | Can a product be deleted? | **No, only hidden**, once it's been sold or stocked. | Sales, debts, and reports must keep pointing to it. | Allow deletion with a warning. |
| 9 | Should cost prices reach staff phones at all? | **No.** The server never sends them to non-owners. | Hiding them only on screen would leave them readable in the phone's storage. | Send everything and hide on screen. |
| 10 | Do Twi translations apply to product names? | **No, only to the app's own words.** Product names stay as typed. | Owners name products in their own words. | Translate names too. |

## Step 4: Developer review

| Story | Before | After | Reason |
|---|---|---|---|
| 1.1 | 3 | 5 | Phone-generated IDs and recording starting stock as a stock entry add sync and Epic 2 work. |
| 1.5 | 3 | 5 | Leaving cost fields out of sync for non-owners needs server-side filtering per role, plus a test of the phone's storage. |
| 1.9 | — | 3 | Gap story: permissions and Twi wording weren't covered by any story. |
| 1.4b | — | 3 | New: prices per size (Decision 2). |
| 1.4c | — | 2 | New: the owner completes cost prices for products the manager adds (Decisions 3–4). |

**Dependencies and effects on other epics:**

- **Epic 0 (Foundations) must come first:** the tech choice, local database, sync, sign-up, and roles (Epic 7) are needed before any product screen works properly.
- **Epic 2 (Stock)** depends on stock entries existing (Decision 7); starting stock is its first use.
- **Epic 3 (Sales)** must store each sale's own price and the retail/wholesale choice (AC21), and compare it with the set price to require a note.
- **Epic 6 (Daily summary)** uses cost prices for profit, so it must only show profit to the owner (Decision 9).
- **Epic 2 (Stock)** must store quantities so half yards are exact (for example, in half-yard units internally), never as rounded decimals.
- **Epic 6 (Daily summary)** gains a **"Close the day"** story for the manager (Decision 11).
- **Sync design:** the server must filter fields by role (cost prices), not only rows by business. That has to be part of the sync design in Epic 0, not added later.

---

# Epic 2: Stock

From Part 1, Epic 2. ## Step 1: Acceptance criteria

**Original intent (from the user stories):** record goods that arrive, size by size; remove damaged, lost or returned goods with a reason; let anyone answer "Do you have size 42?"; warn before a size runs out. Already decided: stock is a list of movements (F-7); sales take stock off automatically (Decision 11); two offline phones can take stock below zero, which is flagged (F-8); half yards for yard products (Decision 6); associates can't add or remove stock (F-17).

### Adding stock

- **AC1: Add stock.** Given I'm the owner or manager, when I choose a product and enter the quantity that arrived for each size, then each size's stock goes up straight away, even with no internet, recorded with my name and the time.
- **AC2: Quick entry for sizes.** Given a product with sizes, then I see every size in one list with a quantity box each, and only sizes with a quantity are recorded (empty boxes mean none arrived).
- **AC3: Valid quantities.** Given I'm adding stock, then each quantity is from 1 to 100,000 (whole numbers, or half yards for yard products); anything else is refused with a clear message, and a delivery with no quantities at all can't be saved.
- **AC4: Optional note.** Given I'm adding stock, then I can add a short note (for example, the supplier's name), up to 200 characters.
- **AC5: Cost stays on the product.** Given I'm the owner adding stock, then I can update the product's cost price from the same screen if the supplier's price changed; managers never see a cost field.

### Removing stock

- **AC6: Remove with a reason.** Given I'm the owner or manager, when I remove stock, then I must choose a reason: **Damaged**, **Lost or stolen**, **Returned to supplier**, **Used or given away**, or **Other** (which needs a written note).
- **AC7: Can't remove what isn't there.** Given a size shows 3 in stock on my phone, when I try to remove 5, then I see "Only 3 in stock" and can't save.
- **AC8: Confirm first.** Given I'm removing stock, then I see a summary ("Remove 2 × Black sandal, size 42: Damaged") and confirm before it's saved; once saved, it can't be edited or deleted, only balanced by adding stock again.
- **AC9: The owner sees removals.** Given anyone removes stock, then the removal appears in that day's summary with the person, product, size, quantity, and reason, for the owner and manager.

### Counting stock

- **AC10: Record a count.** Given I'm the owner or manager, when I count a size and enter the number on the shelf, then the app records the difference as an adjustment (for example, "Counted 4, expected 6: −2") with my name.
- **AC11: Reason for a difference.** Given a count differs from the expected stock, then a reason is required before saving; given it matches, the count is saved as "Checked, correct" with no reason.
- **AC12: Counting during the day close.** Given the manager is closing the day, then the spot-check of shelves uses this same count screen.

### Seeing stock

- **AC13: Stock list.** Given I'm anyone in the shop, then I can see every product with its total stock and, when I open one, the quantity of each size in natural size order, even with no internet.
- **AC14: Search and filters.** Given I'm on the stock list, then I can search by name (as in Epic 1) and filter by **All**, **Low**, **Out of stock**, or **Below zero**.
- **AC15: Units in words.** Given any quantity, then it shows with its unit ("12 pairs", "2.5 yards"), never as a bare number.
- **AC16: Labels in words.** Given a size is low, out, or below zero, then it shows the words "Low", "Out of stock", or "Below zero: check the shelf", never colour alone.
- **AC17: Fast.** Given 2,000 products with sizes, then the stock list opens and filters in under a second on a low-cost Android phone.
- **AC18: Not sent yet.** Given stock changes I made haven't synced, then the product shows "Not sent yet" until they have, and other phones see the change after they sync.

### Low stock

- **AC19: When a size is low.** Given the business's low-stock level is 3, when any size of a product (or a product without sizes) reaches 3 or fewer but more than 0, then it's labelled **Low**; at 0 it's **Out of stock**.
- **AC20: Per-product level.** Given I'm the owner or manager, then I can set a different low-stock level for one product (for example, 10 yards for a popular fabric), or turn warnings off for it.
- **AC21: Low-stock list.** Given I'm the owner or manager, then a **Low stock** list shows every low or out-of-stock size, most urgent first, and the count appears as a badge on the Stock tab.
- **AC22: Hidden products.** Given a product is hidden (Epic 1), then it never appears in low-stock warnings.

### Below zero

- **AC23: Sales are never blocked.** Given a size shows 0 on my phone, when someone sells it, then the sale is saved, stock goes below zero, and the seller sees "Stock shows below zero: tell the manager."
- **AC24: Review list.** Given any size is below zero, then the owner and manager see it in a **Check the shelf** list with the sales that took it below zero; recording a count (AC10) or adding stock clears it.

### History, permissions and language

- **AC25: Stock history.** Given I'm the owner or manager, when I open a size's history, then I see every movement (starting stock, added, sold, returned, exchanged, removed, counted) with the date, person, quantity, and note, newest first.
- **AC26: Who can change stock.** Given I'm a sales associate, then I can see stock but not add, remove, or count it, and the server refuses it even if attempted.
- **AC27: Two languages.** Given my language is Twi, then stock screens, reasons, labels, and messages are in Twi; notes stay as typed.

## Step 2: Stories and points

### Story 2.1: Add stock that arrives

**Points:** 3 | **Priority:** Must have | **Dependencies:** Epic 1 | **Covers:** AC1–AC5

As a shop owner or manager, I want to record a delivery size by size, so that the stock stays correct.

**Technical notes:** one `restock` stock movement per size with a quantity, all written with their outbox operations in one Dexie transaction.

### Story 2.2: Remove stock with a reason

**Points:** 3 | **Priority:** Must have | **Dependencies:** 2.1 | **Covers:** AC6–AC9

As a shop owner or manager, I want to remove damaged, lost, or returned items with a reason, so that the stock matches the shelf and losses are visible.

### Story 2.3: Count stock and record differences

**Points:** 3 | **Priority:** Must have | **Dependencies:** 2.1 | **Covers:** AC10–AC12

As a manager, I want to type what I counted and let the app work out the difference, so that I don't do sums at closing time.

**Technical notes:** the phone sends the **difference** it calculated and the counted number. If other phones' sales arrive later, the server keeps the difference as sent and recalculates stock from all movements; a count is a snapshot, not an overwrite (F-7).

### Story 2.4: Stock list by product and size

**Points:** 3 | **Priority:** Must have | **Dependencies:** Epic 1 | **Covers:** AC13–AC18

As anyone in the shop, I want to see what's left of each size, so that I can answer customers straight away.

**Technical notes:** a `stockLevels` table on the phone (product, size, quantity) updated in the same transaction as every movement, and rebuilt from movements after each pull, so lists don't add up thousands of movements every time they open.

### Story 2.5: Low-stock warnings

**Points:** 3 | **Priority:** Must have | **Dependencies:** 2.4 | **Covers:** AC19–AC22

As a shop owner, I want to see which sizes are running low, so that I restock before losing sales.

### Story 2.6: Below-zero stock to check

**Points:** 2 | **Priority:** Must have | **Dependencies:** 2.4, Epic 3 | **Covers:** AC23–AC24

As a manager, I want a list of sizes that went below zero and the sales behind them, so that I can check the shelf and fix the count.

### Story 2.7: Stock history

**Points:** 2 | **Priority:** Should have | **Dependencies:** 2.1–2.3 | **Covers:** AC25

As a shop owner, I want to see every change to a size's stock, so that I can trace where items went.

### Story 2.8: Stock permissions and Twi wording (gap story)

**Points:** 2 | **Priority:** Must have | **Dependencies:** 2.1–2.7 | **Covers:** AC26–AC27

As a shop owner, I want only me and my manager to change stock, and everyone to see stock screens in their language.

### Story 2.9: Stock counts that stay right when other phones sync late (gap story, added 1 Nov 2026)

**Points:** 2 | **Priority:** Must have | **Dependencies:** 2.3, F5a | **Covers:** Decision 2-5 (clarified)

As a shop owner, I want a count to record what was really on the shelf, so that a sale made on another phone just before the count, but synced later, can't make the stock wrong.

**Acceptance:** a count saves the number counted (with the number the phone showed); stock afterwards is the count plus the movements recorded after it; the difference shown is worked out and corrects itself when late records arrive (phone A shows 10, phone B sells 3 before the count, A counts 8: stock 8, difference +1); a sale near the count time that arrives late flags "Check this count". **Technical notes:** `StockCount` (server plan, Calculated, ADR-24).

**Epic 2 total:** 9 stories, **23 points** (Must have: 21; Should have: 2).

## Step 3: Product owner decisions

| # | Question | Decision | Why | Alternatives considered |
|---|---|---|---|---|
| 2-1 | Where does a delivery's cost go? | **On the product.** A restock records quantities only; the owner updates the product's cost price when the supplier's price changes. Each sale keeps the cost at the time it was sold, for profit. | The manager receives deliveries but can't see costs; the owner already knows what she paid for every item. | A cost on every delivery (the manager can't enter it; the owner would have to fill in every delivery). |
| 2-2 | When is a size "low"? | **Per size, at a business-wide level (default 3),** with an optional different level per product, or warnings off. | Customers ask for a size, not a total; fabrics in yards need a higher level than shoes. | One level for everything; per product total only. |
| 2-3 | Can a removal take stock below zero? | **No.** The phone blocks removing more than it shows. (Sales still can, because the goods have already gone.) | A removal is a choice, so it should match the shelf. If another phone's sale arrives later, the server saves the removal and flags below zero, like a sale. | Allow it with a warning. |
| 2-4 | Removal reasons? | **A fixed list plus Other with a note:** Damaged, Lost or stolen, Returned to supplier, Used or given away, Other. | Quick to choose, easy to total by reason, translatable. | Free text only. |
| 2-5 | How does a count work? | **Type the number counted; the app records the difference.** A matching count is saved as "Checked, correct". (Clarified 1 Nov 2026: the count is saved as **what was on the shelf**, and becomes the new starting point for that size; the difference is worked out from it, so a sale made on another phone just before the count but synced later can't make stock wrong.) | No sums at closing time; checks are recorded even when nothing is wrong. | Type the difference. |
| 2-6 | Can stock records be edited? | **No.** Like sales, a wrong entry is balanced by a new one (add or remove with a reason). | Same rule as every permanent record. | Edit within a few minutes. |
| 2-7 | Who sees removals? | **The owner and manager, in that day's summary,** with the person and reason. | Losses are where money disappears; the owner should see them daily. | Only in stock history. |

## Step 4: Developer review

| Story | Before | After | Reason |
|---|---|---|---|
| 2.4 | 2 | 3 | Adding thousands of movements on every screen would be slow on cheap phones; a `stockLevels` table kept up to date adds work. |
| 2.3 | 2 | 3 | Counts made offline while other phones sell need a clear rule (the difference as sent) and a test. |
| 2.8 | — | 2 | Gap story: permissions and Twi wording. |

**Dependencies and effects on other epics:**

- **Epic 1** already writes starting stock as the first movement; Story 1.1 uses 2.1's code.
- **Epic 3 (Sales)** writes `sale` movements and updates `stockLevels` in the sale's transaction; exchanges and returns write their own movements (Epic 3 corrections).
- **Epic 6 (Daily summary)** shows removals and count differences, and the manager's day close uses the count screen (AC12).
- **Server:** stock on hand is the sum of movements per product, size, and location; add an index on `(businessId, productId, sizeId)` and a `stockLevels` cache only if the check script shows it's needed. Removals and counts are owner and manager only (F-17).
- **Stage 2:** moving stock between locations will add `transfer_out` and `transfer_in` movements; nothing here needs changing.

---

# Epic 3: Sales

From Part 1, Epic 3. Planned in two parts: **3A Selling** (stories 13–18) and **3B Corrections** (stories 19–21). Already decided: a confirmed sale can never be undone, edited or deleted (Decided so far); stock goes down automatically (Decision 11) and can go below zero (F-8); receipt numbers are made on the phone (F-13); sale totals must add up exactly (server plan, sale invariants); every role can sell and record corrections (roles table).

## Step 1: Acceptance criteria

**Original intent (from the user stories):** a sale in a few taps, faster than the notebook; retail or wholesale; a note for any changed price; cash, MoMo, credit or part-paid; a confirmation screen; permanent sales; mistakes fixed by returns and exchanges that keep the original visible.

### 3A Selling: choosing items

- **AC1: Start fast.** Given I open **Sell**, then the search box is ready to type, and below it are the products sold most often in the last 7 days, so common items need no typing.
- **AC2: Product, then size.** Given I tap a product with sizes, then I see its sizes in natural order, each with its price and stock; tapping a size adds it with quantity 1. A product without sizes is added straight away.
- **AC3: Quantity.** Given an item is in the sale, then I can change its quantity with − and + buttons or by typing (whole numbers, or half yards for yard products), up to 100,000.
- **AC4: Several items.** Given a customer buys more than one thing, then I can add more items to the same sale, see the running total, and remove an item before confirming.
- **AC5: Only what's for sale.** Given a product is hidden or a size is removed (Epic 1), then it can't be added to a sale.
- **AC6: Stock warning, never a block.** Given a size shows 0 or less, then I can still add it, with the message "Stock shows 0: tell the manager" (Epic 2, AC23).

### 3A Selling: prices

- **AC7: Retail or wholesale.** Given I'm making a sale, then I choose **Retail** (the default) or **Wholesale** for the whole sale, and every item's price fills in from that price (a product with no wholesale price uses its retail price).
- **AC8: Agreed price.** Given a customer bargains, then I can change an item's price; the set price stays visible beside it ("Set price GH₵ 120.00").
- **AC9: Note for a changed price.** Given an item's agreed price differs from its set price, then a note is required before confirming: I can tap a quick note (**Bargained**, **Regular customer**, **Damaged item**, **Bulk buyer**) or type my own (up to 200 characters).
- **AC10: Low prices.** Given I set a price below the wholesale price, then I see a warning ("Below the wholesale price") and can still continue with the note. Given a price is below the **cost** price, then the seller sees nothing extra, but the owner sees the sale flagged **"Sold below cost"**.
- **AC11: Prices at the time of sale.** Given the owner changed a price that hasn't reached my phone yet, then my sale uses the price my phone knows; the server saves it and marks it for the owner as **"Older price used"** instead of rejecting it.

### 3A Selling: payment

- **AC12: How it was paid.** Given I'm finishing a sale, then I choose **Cash**, **MoMo**, **Cash and MoMo** (two amounts), **Credit**, or **Part-paid** (an amount now, the rest on credit).
- **AC13: Amounts add up.** Given I enter payment amounts, then they can't be more than the total, and for cash and MoMo together they must add up to it; the app never lets the totals disagree.
- **AC14: Change to give.** Given the customer pays cash, then I can type what they handed over and see the change to give ("Received GH₵ 200.00 · Change GH₵ 30.00"); only the sale amount is recorded as received.
- **AC15: Credit needs a customer.** Given any part is on credit, then I must choose a customer, or add one quickly with a name and an optional phone number, without leaving the sale.
- **AC16: Credit limit.** Given the customer has a credit limit, when this sale would take their balance over it, then I see "This takes Ama to GH₵ 650.00, over her limit of GH₵ 500.00". A **sales associate** can't continue (they can sell for cash or MoMo instead, or call the manager); the **owner or manager** can continue, and the sale is flagged **"Over credit limit"** for the owner (Decision 3-3).
- **AC17: Optional customer.** Given a cash or MoMo sale, then I can attach a customer if I want (for their history), but don't have to.

### 3A Selling: confirming and after

- **AC18: Confirm first.** Given I tap **Continue**, then I see every item (name, size, quantity, price, note), the total, the payment, and the customer, with **Back** to change anything and **Confirm sale**. The screen says "A confirmed sale can't be changed."
- **AC19: Saved offline.** Given I confirm, then the sale is saved on my phone straight away, even with no internet, with a receipt number (for example K7M-0042), my name and the time; stock goes down; any credit is added to the customer's balance (shown as "Updating…" until synced).
- **AC20: Ready for the next one.** Given a sale is saved, then I see "Sale saved: K7M-0042" with **Send receipt** and **New sale**, and Sell is empty again.
- **AC21: Receipt.** Given I tap **Send receipt**, then WhatsApp or SMS opens with the receipt ready in the customer's language (shop name, receipt number, date, items, total, paid, owed if any); with no saved phone number, I can type one.
- **AC22: Speed.** Given a regular cash sale of one item, then it takes **under 15 seconds** from opening Sell to "Sale saved" on a low-cost Android phone.
- **AC23: Permanent.** Given a sale is confirmed, then nobody (owner included) has any way to edit or delete it, on the phone or the server; the server refuses any attempt.
- **AC24: Sales list.** Given I open today's sales, then I see each sale's receipt number, time, total, payment, and who recorded it (associates see only their own); past days can be opened the same way.
- **AC25: Sale details.** Given I open a sale, then I see everything on its confirmation screen plus its sync state, any flags (below zero, sold below cost, older price, over limit), and any corrections beneath it.

### 3B Corrections: returns and exchanges

- **AC26: Start from the sale.** Given I open a sale's details, then I can choose **Return items** or **Exchange items**; I can also find a sale by its receipt number.
- **AC27: What can be returned.** Given a sale, then I can return up to the quantity sold minus anything already returned or exchanged, item by item.
- **AC28: Back on the shelf?** Given an item comes back, then I choose **Back in stock** or **Damaged** (a damaged item is recorded as returned and then removed, so stock stays right and the loss shows).
- **AC29: Reason.** Given any correction, then a reason is required: **Wrong size**, **Wrong item**, **Faulty**, **Customer changed mind**, **Seller's mistake**, or **Other** with a note.
- **AC30: Refund for a return.** Given I'm returning items, then their value starts at the price they were sold at, can be lower (with a note), never higher, and is settled in this order (Decision 3-10, changed 1 Nov 2026): **first off what is still owed on that same sale** (automatic, not a choice), **then** back as **Cash** or **MoMo**, up to what the customer actually paid for that sale (less any earlier refunds), **or kept as credit** for her next purchase, **or No refund** (with a note). The screen shows the split before confirming: "GH₵ 40.00 off what Ama owes for this sale, GH₵ 60.00 back in cash."
- **AC31: Exchange.** Given I'm exchanging, then I choose the items coming back and the items going out (any size or product, at today's price for the sale's retail or wholesale choice, changeable with a note); the app shows the difference: **the customer pays** (cash, MoMo or credit) or **the shop gives back** (cash, MoMo or off the debt).
- **AC32: Confirm and save.** Given a correction is ready, then I see a confirmation screen; once confirmed it's saved offline with its own receipt number, can't be changed, and can be sent as a receipt.
- **AC33: Stock and money.** Given a correction is saved, then items back in stock go up, items going out go down, refunds paid in cash or MoMo reduce that day's expected cash or MoMo, and debt refunds reduce the customer's balance.
- **AC34: The original stays.** Given a sale has corrections, then the sale itself is unchanged and shows "Partly returned", "Returned" or "Exchanged" with each correction beneath it.
- **AC35: Two phones, same return.** Given two phones return the same item offline, then the first to reach the server is saved and the second goes to that phone's **Needs attention** with "These items were already returned."
- **AC36: Return period.** Given a sale is more than **7 days** old (the business's return period, which the owner can change), then I can still correct it, but I see "This sale is 12 days old" and must confirm, and the correction is flagged **"After return period"** for the owner (Decision 3-2).
- **AC37: Who can correct which sale.** Given I'm a **sales associate**, then I can return or exchange only **my own** sales (the only ones on my phone); for anyone else's sale I see "Ask the manager". Given I'm the **owner or manager**, then I can correct any sale. The server refuses an associate's correction of someone else's sale (Decision 3-4).

### Both parts

- **AC38: Half yards.** Given a yard product, then quantities, returns and exchanges allow half yards and show as "2.5 yards".
- **AC39: Two languages.** Given my language is Twi, then every sale and correction screen, quick note, reason and receipt is in Twi; product names and typed notes stay as typed. Receipts use the **customer's** language.

## Step 2: Stories and points

### Story 3.1: Pick items into a sale

**Points:** 5 | **Priority:** Must have | **Dependencies:** Epics 1, 2 | **Covers:** AC1–AC6, AC38

As a seller, I want to find products, tap a size and set a quantity, for one or several items, so that recording a sale is faster than writing it down.

**Technical notes:** "most sold in 7 days" is calculated on the phone from local sale items and cached; the sale in progress lives in memory (and is kept if the app is briefly closed) until confirmed.

### Story 3.2: Retail, wholesale and changed prices

**Points:** 3 | **Priority:** Must have | **Dependencies:** 3.1 | **Covers:** AC7–AC11

As a seller, I want prices filled in for retail or wholesale, and to note why I changed one, so that the owner can trust every price.

**Technical notes:** each item stores `setPricePesewas` (what the phone knew) and `agreedPricePesewas`. The server compares `setPrice` with its own price history: a difference is flagged `olderPrice`, never rejected. "Below cost" is flagged on the server, so cost prices never reach sellers' phones.

### Story 3.3: Payment: cash, MoMo, credit and part-paid

**Points:** 5 | **Priority:** Must have | **Dependencies:** 3.1, Epic 4 (customers) | **Covers:** AC12–AC17

As a seller, I want to record exactly how the customer paid, so that the money and debts are right.

**Technical notes:** payments are rows (`SalePayment`), so cash and MoMo together is two rows; credit is what's left (`subtotal − paid`). The quick-add customer is created in the same Dexie transaction as the sale.

### Story 3.4: Confirm and save a sale

**Points:** 5 | **Priority:** Must have | **Dependencies:** 3.1–3.3 | **Covers:** AC18–AC20, AC22

As a seller, I want to check the sale and save it in one tap, so that mistakes are caught before they become permanent.

**Technical notes:** one Dexie transaction writes the sale, items, payments, stock movements, `stockLevels`, the receipt counter and the outbox operation; the sale invariants are checked before it opens.

### Story 3.5: Sales list and sale details

**Points:** 3 | **Priority:** Must have | **Dependencies:** 3.4 | **Covers:** AC24–AC25

As anyone in the shop, I want to look up a sale and see everything about it, so that questions are settled quickly.

### Story 3.6: Send a sale receipt

**Points:** 2 | **Priority:** Should have | **Dependencies:** 3.4 | **Covers:** AC21

As a seller, I want to send the customer a receipt by WhatsApp or SMS, so that they have proof of what they bought and owe.

### Story 3.7: Sales are permanent

**Points:** 2 | **Priority:** Must have | **Dependencies:** 3.4 | **Covers:** AC23

As a shop owner, I want no way to change or delete a sale anywhere, so that the records can always be trusted.

**Technical notes:** a test searches the server code for update or delete calls on sale models and checks the phone code has no such functions.

### Story 3.8: Return items

**Points:** 5 | **Priority:** Must have | **Dependencies:** 3.5 | **Covers:** AC26–AC30, AC32–AC34

As a seller, I want to take items back with a reason and record how the money was returned, so that stock, money and debts stay right.

### Story 3.9: Exchange items

**Points:** 5 | **Priority:** Must have | **Dependencies:** 3.8 | **Covers:** AC31–AC34

As a seller, I want to swap an item for another size or product and record any difference, so that both stock lines and the money are right.

### Story 3.10: Corrections from two phones and return rules

**Points:** 3 | **Priority:** Must have | **Dependencies:** 3.8, 3.9 | **Covers:** AC35–AC37

As a shop owner, I want returns checked against what was really sold, even when two phones are offline, so that nothing is refunded twice.

**Technical notes:** the server locks the original sale's rows in the correction's transaction (server plan, Returns and exchanges); added to the sync torture test.

### Story 3.11: The 15-second sale on a low-cost phone (gap story)

**Points:** 3 | **Priority:** Must have | **Dependencies:** 3.1–3.4 | **Covers:** AC22

As a seller, I want selling to stay fast on a cheap phone with thousands of products and sales, so that I never go back to the notebook.

### Story 3.12: Sales permissions and Twi wording (gap story)

**Points:** 2 | **Priority:** Must have | **Dependencies:** 3.1–3.10 | **Covers:** AC37, AC39

As a shop owner, I want each role to see and correct only the sales it should, and every screen in the user's language.

### Story 3.13: Settling a return or exchange exactly (gap story, added 1 Nov 2026)

**Points:** 3 | **Priority:** Must have | **Dependencies:** 3.8, 3.9, Story 4.13 | **Covers:** AC30, AC31, Decision 3-10

As a shop owner, I want every return settled in the same, exact way, so that nobody gets cash back for goods still owed and the same money is never refunded twice.

**Acceptance:** the value comes from the original line's agreed price; it reduces what's still owed on that same sale first, then goes back in cash or MoMo only up to what was paid for that sale (less earlier refunds), then credit or no refund, and the parts add up exactly; exchanges are settled both ways; cash already handed back offline is saved and flagged "Refund to check" if the figures changed, never rejected. The three worked cases in the server plan pass with their exact numbers. **Technical notes:** server plan, "Returns and exchanges", ADR-21.

**Epic 3 total:** 13 stories, **46 points** (Must have: 44; Should have: 2). 3A Selling: stories 3.1–3.7 and 3.11 (28 points); 3B Corrections: 3.8–3.10 and 3.13 (16 points); 3.12 covers both.

## Step 3: Product owner decisions

| # | Question | Decision | Why | Alternatives considered |
|---|---|---|---|---|
| 3-1 | How low can a seller go? | **Any price, with a note.** Below wholesale: a warning. Below cost: the owner sees "Sold below cost" (the seller can't, because they don't see costs). | Bargaining is normal and sometimes a loss is the right call (old stock); the owner sees every case. | A minimum price that blocks the sale; managers approving low prices (needs the network). |
| 3-2 | Is there a time limit on returns? | **A warning after 7 days, never a block.** The owner can change the period; late corrections are flagged for her. | Shops make exceptions for good customers; the owner still sees every late one. | Block after 7 days (only the owner or manager could correct); no limit. |
| 3-3 | What happens over a credit limit? | **Associates are stopped; the owner and manager are warned and can continue,** and the sale is flagged. Checked on the phone with the balance it knows; the server never rejects a sale for it (the goods have gone), only flags it. | The owner and manager know which customers to trust; associates shouldn't decide that alone. Works offline. | Warn everyone; block everyone. |
| 3-4 | Who can correct which sales? | **Associates: their own sales only. Owner and manager: any sale.** | Associates' phones only hold their own sales (F-9); the owner and manager handle everything else. | Anyone, any sale (associates would need everyone's sales on their phones). |
| 3-5 | Retail or wholesale per sale or per item? | **Per sale.** | A customer is either a retail or a wholesale buyer; one tap instead of one per item. | Per item. |
| 3-6 | Several items in one sale? | **Yes,** with one receipt number and one payment. | Customers often buy several things; one receipt matches what they paid. | One item per sale (slower, many receipts). |
| 3-7 | Cash and MoMo in one sale? | **Yes,** as two payment amounts. | Customers often split ("GH₵ 100 cash, the rest MoMo"); the till check needs both exact. | One method per sale. |
| 3-8 | A price change that hasn't reached the phone? | **The sale keeps the phone's price** and is marked "Older price used" for the owner. | The customer paid what the seller was shown; refusing a real sale would lose it. | Reject and ask the seller to redo it. |
| 3-9 | A returned item that's damaged? | **Recorded as returned, then removed as damaged,** in the same correction. | Stock stays right and the loss shows in the day's removals. | Back into stock regardless. |
| 3-10 | How is a return's value settled? (added 1 Nov 2026) | **Debt on that same sale first, then money back only up to what was paid for that sale (less earlier refunds), then credit or no refund; the parts add up exactly.** The phone enforces it; if another phone's records change the figures, the server still saves the correction (the money was handed over) and flags "Refund to check" for the owner. An exchange that costs more is paid in cash, MoMo or on credit; one that costs less is settled like a return. | Nobody gets cash back for goods still owed on credit, and the same money can never be refunded twice. Matches what a careful trader would do by hand. | The seller chooses freely (allows double refunds); always off the oldest debt (reduces the wrong debt). |

## Step 4: Developer review

| Story | Before | After | Reason |
|---|---|---|---|
| 3.1 | 3 | 5 | Several items per sale, the "most sold" list, and keeping an unfinished sale if the app closes. |
| 3.3 | 3 | 5 | Split payments, quick-add customers inside the sale, and credit-limit checks offline. |
| 3.4 | 3 | 5 | The biggest Dexie transaction in the app (sale, items, payments, movements, levels, counter, outbox). |
| 3.10 | — | 3 | New: two phones returning the same item needs a server lock and a torture test. |
| 3.11 | — | 3 | Gap story: the 15-second target needs testing on a real low-cost phone with large data. |
| 3.12 | — | 2 | Gap story: permissions and Twi wording. |

**Dependencies and effects on other epics:**

- **Epic 4 (Customers)** must exist enough for 3.3: a customer with a name, phone, language, credit limit and balance. Build the customer model with BE8 and the full customer screens in FE8.
- **Epic 2 (Stock)** provides `stockLevels` and the removal used for damaged returns (3-9).
- **Epic 6 (Daily summary)** shows refunds by method, price changes with notes, and the new flags (sold below cost, older price used, over limit).
- **Server:** new flags `belowCost` and `olderPrice` on Sale; `CorrectionItem` gains `condition (restock|damaged)`; a product price history (from `ChangeLog`) to check `setPrice`.
- **Build order:** 3A (BE8 → FE7) first, then Epic 4, then 3B (BE10 → FE9), as in the plans.

---

# Epic 4: Customers and debts

From Part 1, Epic 4. Already decided: credit sales need a customer, and the credit limit is handled by role (Decision 3-3); everyone, associates included, records repayments with a receipt to the customer (F-17); balances are calculated on the server and sent to every phone (server plan, Calculated); weekly reminders are in Epic 5.

## Step 1: Acceptance criteria

**Original intent (from the user stories):** save customers; credit sales add to their balance; record full or part repayments; a credit limit per customer; a list of who owes, how much and for how long; each customer's history, with who recorded what.

### Customers

- **AC1: Add a customer.** Given I'm anyone in the shop, when I enter a name (required, up to 80 characters), an optional phone number, and their language (English or Twi, defaulting to the business's), then the customer is saved straight away, even offline, from the Customers screen or in the middle of a sale.
- **AC2: Phone numbers.** Given I enter a phone number, then it's accepted as 024…, 24… or +233 24…, saved as +233…, and refused with "Check the phone number" if it isn't a valid Ghana mobile number.
- **AC3: Same phone number.** Given a customer already has this phone number, then I'm warned "Ama Mensah already has this number" and can open her instead, or save anyway (family members may share a phone).
- **AC4: Find a customer.** Given I type part of a name or phone number, then matching customers appear as I type, offline, in under half a second with 2,000 customers.
- **AC5: Edit a customer.** Given I'm the owner or manager, then I can change a customer's name, phone number and language; every change is kept in the history (who and when). Sales associates can't edit customers, and the server refuses it.
- **AC6: Hide a customer.** Given I'm the owner or manager, when a customer owes nothing, then I can hide them from lists; a customer who owes can't be hidden ("Ama still owes GH₵ 120.00").

### Balances and limits

- **AC7: Balance.** Given a customer has bought on credit, then their balance (what they owe) shows on their page and in every list, from the server's figure; my phone's own unsent sales and repayments are added on top and labelled "Updating…".
- **AC8: Default limit.** Given the owner has set a default credit limit (for example, GH₵ 200), then every new customer starts with that limit.
- **AC9: Change a limit.** Given I'm the owner, then I can raise, lower, or remove ("No limit") a customer's credit limit. Managers and associates see the limit but can't change it.
- **AC10: Over the limit.** Given a credit sale would take a customer over their limit, then associates are stopped and the owner and manager are warned (Decision 3-3).

### Repayments

- **AC11: Record a repayment.** Given a customer owes, when I enter an amount and choose Cash or MoMo (with an optional note, such as a MoMo reference), then I see a confirmation ("Ama pays GH₵ 50.00 by MoMo. She will owe GH₵ 70.00."), and once confirmed it's saved offline with a receipt number, my name and the time.
- **AC12: Part or full.** Given a customer owes GH₵ 120.00, then I can record any amount from GH₵ 0.01 up to GH₵ 120.00; **Pays everything** fills in the full balance.
- **AC13: Not more than owed.** Given my phone shows she owes GH₵ 120.00, when I enter more, then I see "Ama only owes GH₵ 120.00" and can't save.
- **AC14: Receipt.** Given a repayment is saved, then **Send receipt** opens WhatsApp or SMS with the amount, method, new balance, receipt number and date, in the customer's language.
- **AC15: Repayments are permanent.** Given a repayment is saved, then nobody can edit or delete it.
- **AC16: Correct a wrong repayment.** Given I'm the owner or manager, when a repayment was recorded wrongly (for example, 500 instead of 50), then I record a **correction** with a reason, which reverses it; the original stays visible with "Corrected" and the reason beneath it, and the balance is right again. The correct amount is then recorded as a new repayment.

### Who owes and history

- **AC17: Who owes me.** Given I'm the owner or manager, then **Who owes** lists every customer with a balance, with the amount and how long they've owed (from their oldest unpaid credit: "12 days"), sortable by **Most owed** or **Owed longest**, with the total owed at the top.
- **AC18: Over the limit and long debts.** Given a customer is over their limit, or has owed for 30 days or more, then the list says so in words ("Over limit", "30+ days").
- **AC19: Associates' view.** Given I'm a sales associate, then I can search customers and see each one's balance and limit (to sell and take repayments), but not the Who owes list or the total.
- **AC20: Customer history.** Given I'm the owner or manager, when I open a customer, then I see every credit sale, return or exchange, repayment, correction and write-off, newest first, with the date, amount, receipt number, who recorded it, and the balance after each.
- **AC21: Associates' history.** Given I'm a sales associate, then a customer's history shows only what I recorded, plus their current balance.

### Writing off a debt

- **AC22: Write off.** Given I'm the owner and a customer will clearly never pay, when I write off their debt (all or part) with a reason (**Moved away**, **Died**, **Disputed**, **Other** with a note) and confirm, then their balance goes down by that amount, the write-off is permanent and shows in their history, and it counts as a loss in the owner's figures.
- **AC23: Only the owner.** Given I'm a manager or associate, then I can't write off debts, and the server refuses it.
- **AC23b: Reverse a wrong write-off.** Given I'm the owner and wrote off the wrong amount (for example GH₵ 500.00 instead of GH₵ 50.00), when I reverse it with a reason, then the whole write-off is cancelled (she owes the GH₵ 500.00 again), the original stays visible with "Reversed" and the reason, and I record the right write-off as a new one. A write-off can be reversed only once, and a reversal can't be reversed (added 1 Nov 2026, Decision 4-9).

### Offline, two phones and language

- **AC24: Two phones, one debt.** Given two phones each record a repayment for the same customer offline, and together they're more than she owed, then **both are saved** (the money really was received), her balance shows as **in credit** ("Shop owes Ama GH₵ 20.00"), and the owner and manager see it flagged to sort out (give it back or keep it for her next purchase).
- **AC25: Customer in credit.** Given a customer is in credit, then her next credit sale uses that amount first, and her page shows "In credit: GH₵ 20.00".
- **AC26: Two languages.** Given my language is Twi, then customer screens, reasons and messages are in Twi; customer names and notes stay as typed. Receipts use the **customer's** language.

### Debts from before the app (added 1 Nov 2026)

- **AC27: Debt brought forward.** Given I'm the owner or manager and a customer already owed money in the notebook, when I add **Owed before Shop Book** with the amount, the date the debt started (it can be in the past) and an optional note, then it's added to her balance as a permanent record with my name and the time, even offline. It counts in **Who owes**, the debt's age (from that date) and the weekly reminders, like a credit sale.
- **AC28: Not today's sales.** Given a debt brought forward is recorded, then it doesn't appear in any day's sales, credit given or profit; Today shows it on its own line ("Debts brought forward: GH₵ 300.00") so the day's figures stay honest.
- **AC29: Correct a wrong amount.** Given a debt brought forward was typed wrongly, then the owner or manager records a **correction** with a reason, which reverses it; the original stays visible with "Corrected" beneath it, and the right amount is added as a new one (the same rule as repayments, AC16).
- **AC30: Only owner and manager.** Given I'm a sales associate, then I can't add debts brought forward, and the server refuses it.

## Step 2: Stories and points

### Story 4.1: Add and find customers

**Points:** 3 | **Priority:** Must have | **Dependencies:** Epic 0 | **Covers:** AC1–AC4

As a seller, I want to add a customer quickly and find them again, so that I can record what they owe.

**Technical notes:** the basic customer is built with Sales (Story 3.3); this story adds the Customers screen, search on a normalised name and phone, and the duplicate warning.

### Story 4.2: Edit and hide customers

**Points:** 2 | **Priority:** Must have | **Dependencies:** 4.1 | **Covers:** AC5–AC6

As a shop owner or manager, I want to correct customer details and tidy the list, so that the records stay right.

### Story 4.3: Balances on every phone

**Points:** 3 | **Priority:** Must have | **Dependencies:** 4.1, Story 3.4 | **Covers:** AC7

As anyone in the shop, I want to see what each customer owes, even for sales other people recorded, so that I never sell on credit blindly.

**Technical notes:** the server's `balancePesewas` plus this phone's unsent records ("Updating…").

### Story 4.4: Credit limits and the default limit

**Points:** 2 | **Priority:** Must have | **Dependencies:** 4.1 | **Covers:** AC8–AC10

As a shop owner, I want every new customer to start with a sensible limit that I can change, so that nobody runs up a big debt by accident.

### Story 4.5: Record a repayment

**Points:** 3 | **Priority:** Must have | **Dependencies:** 4.3 | **Covers:** AC11–AC15

As anyone in the shop, I want to record what a customer pays back and send them a receipt, so that their balance is right and they have proof.

### Story 4.6: Correct a wrong repayment

**Points:** 2 | **Priority:** Must have | **Dependencies:** 4.5 | **Covers:** AC16

As a shop owner or manager, I want to reverse a repayment typed wrongly, so that balances are right without deleting anything.

### Story 4.7: Who owes me

**Points:** 3 | **Priority:** Must have | **Dependencies:** 4.3 | **Covers:** AC17–AC19

As a shop owner, I want a list of everyone who owes, how much and how long, so that I know whom to follow up.

### Story 4.8: Customer history

**Points:** 3 | **Priority:** Must have | **Dependencies:** 4.5, Epic 3 | **Covers:** AC20–AC21

As a shop owner, I want every sale, repayment and correction for a customer in one place, with who recorded it, so that I can settle any disagreement.

**Technical notes:** the owner's and manager's phones hold all sales; an associate's history is limited to their own records (F-9).

### Story 4.9: Write off a debt

**Points:** 2 | **Priority:** Should have | **Dependencies:** 4.3 | **Covers:** AC22–AC23

As a shop owner, I want to write off a debt that will never be paid, with a reason, so that my list shows real debts and my figures show the loss.

### Story 4.10: Overpayment from two phones (gap story)

**Points:** 2 | **Priority:** Must have | **Dependencies:** 4.5 | **Covers:** AC24–AC25

As a shop owner, I want money received on two phones always recorded, even if it's more than was owed, so that cash in the drawer always matches the records.

### Story 4.11: Customer permissions and Twi wording (gap story)

**Points:** 2 | **Priority:** Must have | **Dependencies:** 4.1–4.10 | **Covers:** AC5, AC9, AC19, AC23, AC26

As a shop owner, I want each role to see and change only what it should about customers, in their own language.

### Story 4.12: Debts brought forward from the notebook (added 1 Nov 2026)

**Points:** 3 | **Priority:** Must have | **Dependencies:** 4.3, 4.6 | **Covers:** AC27–AC30

As a shop owner, I want to enter what customers owed before we started using the app, so that their balances, the Who owes list and reminders are right from day one.

**Technical notes:** a new permanent record (`OpeningDebt`) synced like a repayment; corrections reverse it (`correctsOpeningDebtId` and a reason). The balance formula and `oldestUnpaidAt` include it, using its "owed since" date; the daily report lists it separately and never counts it as sales.

### Story 4.13: Debt lots and credit lots (gap story, added 1 Nov 2026)

**Points:** 5 | **Priority:** Must have | **Dependencies:** 4.3, 4.5, 4.12 | **Covers:** AC7, AC17, AC24, AC25, Decision 4-7

As a shop owner, I want to see exactly which debt each repayment, return or write-off paid, so that a customer's history is right, not just her total.

**Acceptance:** every debt (debt brought forward, credit sale, exchange on credit) is a lot; a return reduces its own sale's lot; repayments and write-offs pay the oldest lot first; money beyond what's owed becomes credit, used oldest first by the next debt; the same records arriving in any order give the same lots and balance (tested by shuffling); the worked example gives lot A GH₵ 100.00 and lot B GH₵ 200.00; a customer with 5,000 records updates in under 20 ms. **Technical notes:** `DebtLot`, `CreditLot`, `DebtAllocation` as server-made projections; server plan, Calculated, ADR-20.

### Story 4.14: Reverse a wrong repayment, debt brought forward or write-off (gap story, added 1 Nov 2026)

**Points:** 2 | **Priority:** Should have | **Dependencies:** 4.6, 4.9, 4.12 | **Covers:** AC23b, Decision 4-9

As a shop owner, I want to cancel a wrongly recorded write-off (or repayment, or debt brought forward) completely and record the right one, so that mistakes are fixed without editing anything.

**Acceptance:** a reversal cancels the original in full, with a reason; each original can be reversed once; a reversal can't be reversed; both stay in the history. **Technical notes:** server plan, Reversals, ADR-25. (Story 4.6 already covers repayments; this story adds write-offs and the shared once-only rules.)

**Epic 4 total:** 14 stories, **37 points** (Must have: 33; Should have: 4).

## Step 3: Product owner decisions

| # | Question | Decision | Why | Alternatives considered |
|---|---|---|---|---|
| 4-1 | A debt that will never be paid? | **The owner can write it off** (all or part) with a reason; permanent, in the history, a loss in her figures. | The Who owes list stays honest, and the loss is visible instead of hidden. | Not in stage 1 (the debt stays forever). |
| 4-2 | A repayment recorded wrongly? | **The owner or manager records a correction** with a reason; the original stays visible. | Same rule as sales and expenses: nothing permanent is edited. | Owner only. |
| 4-3 | Credit limit for new customers? | **A shop-wide default** set by the owner, copied to each new customer; the owner changes it per customer or removes it. | Safe by default; trusted customers get more. | No limit until the owner sets one. |
| 4-4 | Who can edit customer details? | **Owner and manager.** Everyone can add customers. | Associates must add customers mid-sale, but names and numbers shouldn't change without a senior person. | Everyone, with history. |
| 4-5 | Repayments from two phones that add up to more than was owed? | **Both are saved; the customer is "in credit"** and it's flagged. The phone stops overpaying with the balance it knows; the server never rejects real money. | Rejecting a repayment the shop really received would make the cash check wrong. | Reject the second (loses a record of real money). |
| 4-6 | Can associates see who owes? | **They see any customer's balance and limit, but not the Who owes list or the total.** | They need balances to sell and collect; the full list is for following up. | Full list for everyone. |
| 4-7 | When does a debt's age start? | **From the oldest credit sale not yet paid off** (repayments pay the oldest first). | Matches how traders think ("she's owed since the 3rd") and drives weekly reminders (Epic 5). | From the last sale; from the first sale ever. |
| 4-8 | Debts owed before the shop started using the app? | **A "debt brought forward" record** (owner or manager), with the amount, the date it started and a note; permanent, corrected like a repayment. Counted in balances, Who owes, age and reminders, **never** in a day's sales or profit. Added 1 Nov 2026. | Shops start with customers who already owe; entering fake credit sales would make past days' sales and stock wrong. | Fake credit sales; typing a starting balance on the customer (editable, no history). |
| 4-9 | How are wrong repayments, debts brought forward, write-offs and expenses fixed? (added 1 Nov 2026) | **A full reversal, then a new correct record.** Each original can be reversed once; a reversal can't be reversed (record the original again instead). Write-offs: owner only; the others: owner and manager. | One simple rule everywhere means it's never unclear which amount is in effect, and the history always shows what happened. | Partial corrections ("difference" records; hard to follow); editing (breaks permanent records). |

## Step 4: Developer review

| Story | Before | After | Reason |
|---|---|---|---|
| 4.3 | 2 | 3 | Showing the server balance plus unsent local records, on phones that don't hold everyone's sales. |
| 4.8 | 2 | 3 | Different history per role, and the balance after each line. |
| 4.10 | — | 2 | Gap story: two phones taking repayments offline can overpay; needs a rule and a test. |
| 4.11 | — | 2 | Gap story: permissions and Twi wording. |

**Dependencies and effects on other epics:**

- **Epic 3:** the basic customer and quick-add are built with Sales (BE8, FE7); credit in a sale uses any "in credit" amount first (AC25).
- **Epic 5 (Reminders):** uses the debt's age (4-7) and the customer's language.
- **Epic 6 (Daily summary):** shows debts collected by method, repayment corrections, write-offs (owner), and customers in credit.
- **Server:** the balance becomes debts brought forward (corrections count as negative) + credit − debt refunds − repayments (corrections count as negative repayments) − write-offs; it may go below zero (in credit). `oldestUnpaidAt` is recalculated with oldest-first allocation. New permanent record **DebtWriteOff**; `Repayment` gains `correctsRepaymentId` and `correctionReason`; the business settings gain `defaultCreditLimitPesewas` (in `BusinessSettings`, server plan); flag `overpaid`. Balances come from **debt lots** (each debt brought forward, credit sale or exchange on credit) and **allocations** (which lot each repayment, write-off or return reduced), rebuilt in one fixed order, so late offline records give the same result (server plan, ADR-20). A return reduces its own sale's debt; repayments and write-offs pay the oldest debt first.

---

# Totals so far (Epics 0–4)

| Epic | Stories | Points | Must have | Should have |
|---|---|---|---|---|
| 0: Foundations | 18 | 85 | 75 | 10 |
| 1: Products, sizes and prices | 12 | 40 | 37 | 3 |
| 2: Stock | 9 | 23 | 21 | 2 |
| 3: Sales and corrections | 13 | 46 | 44 | 2 |
| 4: Customers and debts | 14 | 37 | 33 | 4 |
| **Total** | **66** | **231** | **210** | **21** |

---

# Epics still to plan

These epics from Part 1 go through the four steps next, in this order:

| Order | Epic | User stories |
|---|---|---|
| 1 | Epic 6 and 6b: Daily summary, expenses, and closing the day | |
| 2 | Epic 5: Keeping customers informed | Statements, receipts, weekly reminders, customer language |

Until an epic is planned here, `docs/server-plan.md` and `docs/app-plan.md` describe it in enough detail to build; both are updated when the epic's decisions are made.
