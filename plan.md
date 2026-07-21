# Updates to the Project Specification

# Environment Variables

Create a `.env` file with the following variables.

# External Vehicle API
VEHICLE_API_KEY=8301c2d9c6269adc70a13e47a42db6b7

# Admin Dashboard Password
ADMIN_PASSWORD=iBzLxsYDxTuE2hge

# Database
DATABASE_URL=postgresql://neondb_owner:npg_L9u1xBoOQlwR@ep-cool-voice-avyyg1xd-pooler.c-11.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require

# Cache Settings
CACHE_DURATION_DAYS=7

# Buy Credits Placeholder URL
BUY_CREDITS_URL=https://www.keylibrary.co.uk/




## Tech Stack

Create a brand new **Node.js + Express + TypeScript** project.

Deploy on **Vercel**.

Do not use Next.js.

---

# Registration Checker Page (/)

This page will be embedded inside a Shopify page using an iframe.

Since Shopify already provides the website layout (header, navigation, footer), **keep this page as minimal as possible**.

Do **not** create a full website layout.

The page should only contain:

- Remaining Lookup Credits
- Registration Search Input
- Submit Button
- Loading State
- Vehicle Information Result
- Recent Lookup History (optional, last 5-10 lookups)

Nothing else.

No header.

No footer.

No navigation.

The iframe should look clean inside the Shopify page.

---

# Buy Credits Button

For now there is **no payment integration**.

Do **not** integrate:

- Stripe
- PayPal
- Shopify Checkout
- Any payment gateway

Simply display a button when the customer has no credits.

Example:

```
Buy Credits
```

For now clicking the button should redirect to

```
https://www.keylibrary.co.uk/
```

This is only a placeholder.

Later this will be replaced with a hidden Shopify product that customers can purchase to receive lookup credits.

Build the code so replacing the URL later is easy.

---

# Customer Credits

Display remaining credits above the search box.

Example

```
Vehicle Lookup Credits

12 Credits Remaining
```

If credits are zero:

- Disable the Submit button.
- Display a message explaining that no lookup credits remain.
- Show the Buy Credits button.

---

# Registration Checker UI

Keep it very simple.

Only include:

- Credits Remaining
- Registration Input
- Submit Button
- Loading Indicator
- Vehicle Details Result

The design should be lightweight because it will be displayed inside an iframe on the Shopify store.

---

# Admin Dashboard (/admin)

Unlike the customer page, the admin dashboard should have a proper layout.

Include a header.

Header should contain the Key Library logo.

Use this logo:

https://www.keylibrary.co.uk/cdn/shop/files/Key-Library_logo-grey-tagline-2023_250x.png?v=1685546021

Header should include:

- Logo
- Dashboard title
- Logout button

The rest of the admin dashboard should include:

- Statistics
- Customer Credits
- Lookup History
- Cached Registrations
- CSV Export

---

# Admin Authentication

Before displaying the dashboard:

Show a password popup.

Password should be compared against

```
process.env.ADMIN_PASSWORD
```

If correct:

Create a secure session.

If incorrect:

Remain on the login popup.

No username is required.

Only a password.

---

# Future Credit Purchases

Design the code so that replacing the placeholder Buy Credits button is simple.

Eventually the flow will become:

Customer clicks

```
Buy Credits
```

↓

Redirect to a hidden Shopify product

↓

Customer completes checkout

↓

Shopify awards lookup credits

No implementation is required yet.

Only keep the architecture ready for this future enhancement.