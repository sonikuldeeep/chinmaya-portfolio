# Chinmaya Shrivastava — Personal Site

A single-page personal site for Chinmaya Shrivastava, built with HTML5, CSS3 and vanilla JavaScript. No frameworks, no build step and no dependencies apart from Google Fonts.

**Creative concept:** *The intersection of finance, technology & possibility.*

## Run locally

Open `index.html` in a browser. To serve it locally instead:

```bash
npx serve .          # or: python -m http.server 8000
```

## Structure

```
chinmaya-portfolio/
├── index.html        # All content and semantic markup
├── styles.css        # Design tokens, components, sections, responsive rules, reduced motion
├── script.js         # Nav, menu, reveals, ecosystem particles, timeline, article reader, canvas, back-to-top
├── admin/
│   ├── admin.js      # Password-protected in-page editor (loaded only when Admin is opened)
│   ├── admin.css
│   └── backups/      # Created automatically: previous index.html on every save
├── assets/
│   ├── images/{profile,projects,events,education}/
│   ├── icons/favicon.svg
│   └── documents/    # Put a genuine CV here if you want to offer one
└── README.md
```

## Going live: GitHub Pages + publishing from the admin

The site is hosted on **GitHub Pages**. Once the admin is connected to the repository, **Publish** commits your changes, and every visitor sees them about a minute later. Pages can cache for up to about 10 minutes, so press Ctrl+F5 if you don't see an update yet.

**One-time setup**
1. Put this folder in a GitHub repository (public; that's required for free Pages) and enable **Settings → Pages → Deploy from a branch → `main` / root**.
2. Create a **fine-grained access token**: GitHub → Settings → Developer settings → Fine-grained tokens → *Generate new token*.
   - Repository access: **Only select repositories → this repository**
   - Permissions: **Contents → Read and write**. Nothing else is needed.
   - Pick an expiry, then copy the token.
3. Open the live site, click **Admin**, sign in, then go to **Settings → Publish to the live site**. Enter owner, repository, branch (`main`) and the token. Click **Test connection**, then **Apply**. On a `*.github.io` address, owner and repository are filled in automatically.

**Day to day:** open the live site → Admin → edit → **Publish**. Every publish is a normal git commit, so you can see or undo any change in the repository's history.

**Security:** the token is the real key. It's stored only in your browser on that device (untick "Remember" on shared computers), and never in the site files. Anyone without it can open the editor at most; they can't publish anything. If a device is lost, revoke the token on GitHub.

## Admin editor: edit text and upload images in the browser

1. Open the site and click **Admin** in the footer, or add `#admin` to the URL.
2. Sign in with the admin password you were given. You can change it in **Settings → Change password** and then Publish. The password itself is never stored in these files, only its SHA-256 hash.
3. Edit the page:
   - **Text:** click any text and type. Clicking a ✎ placeholder selects it, so typing replaces it.
   - **Images:** click the portrait, a project visual, an event frame or a timeline logo to upload a picture. You can drag and drop, and you can set the alt text. Photos are resized automatically.
   - **Items:** hover a role, article, project, event, tag and so on to get a toolbar. It can **move up/down**, **duplicate**, **delete**, and for roles **★ mark as current**.
   - **Articles:** hover an article and click **Edit**, or click the featured article. Fill in the title, category, excerpt, date and LinkedIn URL.
   - **Links:** focus link text, such as the LinkedIn button, and an **Edit link** button appears.
   - **Contact email:** Settings → Contact email adds a mailto button.
4. Click **Publish** / **Save** (or press Ctrl+S).
   - **GitHub connected:** the button says **Publish** and updates the live site for everyone (see above).
   - **Working locally in Chrome / Edge:** the first time, choose the `chinmaya-portfolio` folder. After that, Save writes `index.html` and the images (into `assets/images/…`) straight into the folder. The previous `index.html` is copied to `admin/backups/` first.
   - **Other browsers:** Save downloads an `index.html` with the images embedded. Replace the old file with it.
5. Use **Preview** to see the page without the editing outlines, and **Log out** when you're done.

**About the password:** this is a static site with no server. The password keeps casual visitors out of the editor, but it isn't server-side security; the hash sits in the page's `<meta name="admin-key">`. That's safe in practice, because edits are only ever written to files on *your* computer. A visitor who opened the editor could change only their own browser view, never your published site. If you'd rather not ship the editor at all, delete the `admin/` folder before uploading the site. The footer Admin link then does nothing.

**Forgot the password?** In `index.html`, replace the `admin-key` value with the SHA-256 hash of `cs-portfolio:` followed by your new password. For example, run this in a terminal:
`node -e "console.log(require('crypto').createHash('sha256').update('cs-portfolio:NEW-PASSWORD').digest('hex'))"`

## Content status: please read

LinkedIn blocks automated access, and the workspace had no screenshots or documents. So the only facts on the site are ones the brief supplied:

- Name, LinkedIn URL and the IIM Kozhikode association
- Hero copy, headline and contact copy, used word for word from the brief
- The six expertise domains, taken from the brief's descriptions
- Project names: Genius MAPS, RxOffice Legal & Recovery, NPA Transaction Management, MSG91, Lsquared Digital Signage. His association with each one is **not yet confirmed**.

Every other fact is an **editable placeholder**. In the HTML it looks like this:

```html
<span class="ph">Current designation</span>
```

On the page, placeholders are muted, underlined with a dashed line and marked ✎. While you're signed in as admin, a **"Draft · N fields to complete"** button in the bottom-left counts them; click it to highlight them all. The easiest way to fill them in is the admin editor above.

### Checklist

| Section | What to supply | Where |
|---|---|---|
| Hero / About | Current designation, organization, location | `.hero__meta`, `.facts` |
| About | Background, approach, leadership, outlook paragraphs (ideally from his About section) | `#about .about__cols` |
| Portrait | Photo files; set `data-portrait="assets/images/profile/portrait.jpg"` on both `<figure data-portrait>` | hero + about |
| Journey | One `<li class="tl__item">` per role: title, organization, dates, location, description, responsibilities, contributions, optional logo | `#timeline` (a template comment is included) |
| Projects | Industry, intro, challenge, approach, his documented role, solution, technologies | `#projects .case` |
| Insights | Real LinkedIn posts: fill `data-title`, `data-excerpt`, `data-meta`, `data-url` on each `.read` button, and replace the visible title | `#reads` |
| Engagement | Event photos in `assets/images/events/`, plus captions. If there are no verified events, delete the `#engagement` section | `#engagement` |
| Education | IIMK programme, subject, period; any other degrees or certifications | `#education` |
| Recommendations | Genuine recommendations only. A commented-out template sits above `#contact`. If you add it, renumber Contact to 09 | HTML comment |
| Contact | Verified email and CV link. Both are commented out in `#contact` | `#contact` |
| SEO | `canonical` and `og:image` once the site has a live URL; `jobTitle` / `worksFor` in the JSON-LD | `<head>` |

**Rule:** don't add titles, dates, figures, testimonials or articles unless they come from a verifiable source.

## Design system (summary)

- **Colour:** `#080E1C` base, `#0D1629` / `#111E35` surfaces, `#3478F6` electric blue, `#00C2E0` cyan, `#F5F7FC` / `#A6B1C5` text. The muted text colour was raised to `#8693AB` to meet AA contrast on small type.
- **Type:** Manrope (headings), Inter (body), Space Grotesk (labels and metadata)
- **Spacing:** 4px-based scale in `:root`; section rhythm is `clamp(88px, 11vw, 168px)`
- **Motion:** one easing family, durations of 0.25s, 0.5s and 0.9s. Everything is disabled under `prefers-reduced-motion`, and all content stays visible without JS.

## Interactions

Sticky nav that turns solid on scroll, active-section indicator, accessible mobile menu (focus trap, Esc to close), hero entrance and text-mask reveals, animated SVG ecosystem with SMIL particles (paused when off-screen), Intersection-Observer reveals, expertise counter, timeline accordion with scroll progress and arrow-key navigation, project visuals that animate on reveal and hover, featured-article reader (click, prev/next, arrow keys), contact network canvas (runs only when visible), back-to-top button with a progress ring.

## Tested

Rendered in headless Chrome at 1440, 834, 390 and 320px wide. No console errors, no horizontal overflow, no broken anchor links. Checked the menu open/close and focus behaviour, the timeline toggle, the article reader and the active-nav tracking.
