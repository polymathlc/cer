# Prebuilt Tailwind CSS

`index.html` used to load the **Tailwind Play CDN**
(`<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries">`).
That script is a full CSS compiler: every student's browser downloaded it,
scanned the whole DOM, generated the stylesheet, and did it again on every DOM
mutation. Tailwind's own documentation says not to use it in production.

The generated CSS is now inlined into `index.html` as a plain `<style>` block,
in the same place the CDN used to inject its own, so the cascade is unchanged.

**The app uses no Tailwind utility classes.** The only thing it actually needed
was the `@tailwindcss/forms` base layer, which styles every `input`, `select`,
`textarea` and checkbox in the app. That is what the generated file contains —
about 14 KB, or 2.7 KB over the wire.

## Regenerating

Only needed if the theme changes, or if Tailwind utility classes are ever
actually used in the markup:

```sh
cd docs/tailwind
npm i tailwindcss@3.4.17 @tailwindcss/forms @tailwindcss/container-queries
npx tailwindcss -c tailwind.config.js -i input.css -o out.css --minify
```

Then replace the contents of the `<style>` block in `index.html` that is
labelled `Tailwind, prebuilt` with the contents of `out.css`.
