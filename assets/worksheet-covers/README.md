# Worksheet cover artwork

Current covers use the expanded sixteen-motif atlases and small scattered layout.
See [README-v2.md](README-v2.md) for the current assets and exact generation prompts.
The original six-motif files below are retained unchanged for provenance.

Generated with the built-in image generation tool on 22 October 2026. These are original transparent RGBA pixel-art atlases, 1536 × 1024 pixels, with three columns and two rows. The production PNGs are kept unmodified. `worksheet-cover.js` crops each equal cell using real image elements, so artwork prints when browser background graphics are disabled.

Science cells: atom, test tubes, flask / microscope, DNA, seedling.
Math cells: π, √, ÷ / ×, =, %.

The palette uses pale teal, aqua, pink and lilac derived from the existing Polymath logo. The original logo remains in `assets/branding/`; covers apply a gentle pastel treatment in CSS.

## Generation prompts

### science-icons.png

Use case: scientific-educational. Asset type: production transparent icon sprite atlas for Polymath Learning Centre science worksheet covers. Create ONE landscape 1536x1024 transparent PNG containing exactly SIX separate pixel-art science icons in a perfectly regular THREE COLUMN by TWO ROW grid; each cell 512x512; each icon centred entirely inside its cell with generous 90px empty margins. Top row left to right: atom with three orbital loops; a pair of test tubes containing pastel liquids; conical laboratory flask. Bottom row: microscope; DNA double helix; seedling with two leaves. Style: crisp charming 16-bit pixel art with visible square steps, clean geometric silhouette, no blur, no smooth vector curves. LIGHT PASTEL colours derived from teal/cyan and magenta logo: mint #b7e0df, pale aqua #c7eaf0, dusty teal #8dbfc4, blush pink #edc5dc, pale lilac #dcd6ee. Modest slightly darker pastel outlines to stay visible on white paper. Keep subjects recognizable but simplified. Actual alpha transparency in all negative space; no background, no checkerboard painted in, no tile borders, no text, no letters, no numbers, no math symbols, no shadows outside icons, no logo, no watermark. Uniform icon scale and visual weight. This is an atlas to crop each equal square cell in UI, so icons must never cross cell boundaries.

### math-icons.png

Use case: scientific-educational. Asset type: production transparent icon sprite atlas for Polymath Learning Centre MATHEMATICS worksheet covers. Create ONE landscape 1536x1024 transparent PNG containing exactly SIX separate pixel-art MATH SYMBOL icons in a perfectly regular THREE COLUMN by TWO ROW grid; each cell 512x512; each icon centred entirely inside its cell with generous 100px empty margins. Top row left to right: the pi symbol π; square root symbol √; division symbol ÷ (one horizontal bar between two dots). Bottom row left to right: multiplication symbol ×; equals symbol = (two horizontal bars); percent symbol % (diagonal slash with two hollow circles). Each cell contains ONLY its one named recognizable mathematical symbol. Style: crisp charming 16-bit pixel art with visible square steps, subtly dimensional block construction, clean geometric silhouettes, no blur, no smooth vector curves. LIGHT PASTEL colours derived from teal/cyan and magenta logo: mint #b7e0df, pale aqua #c7eaf0, dusty teal #8dbfc4, blush pink #edc5dc, pale lilac #dcd6ee. Modest slightly darker pastel outlines to stay visible on white paper. Actual alpha transparency in all negative space; no background, no checkerboard painted in, no tile borders, no words, no labels, no laboratory equipment, no science imagery, no logo, no watermark. Uniform icon scale and visual weight. This is an atlas to crop each equal square cell in UI, so icons must never cross cell boundaries.
