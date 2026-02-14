# App Icon Generation

You need to generate PNG icons in multiple sizes for the PWA to work properly.

## Quick Option: Use Online Tool

1. Go to https://www.pwabuilder.com/imageGenerator
2. Upload a 512x512px image with your logo
3. Download the generated icon pack
4. Replace the files in this `/icons` directory

## Required Sizes

- 72x72px → `icon-72x72.png`
- 96x96px → `icon-96x96.png`
- 128x128px → `icon-128x128.png`
- 144x144px → `icon-144x144.png`
- 152x152px → `icon-152x152.png`
- 192x192px → `icon-192x192.png`
- 384x384px → `icon-384x384.png`
- 512x512px → `icon-512x512.png`

## Design Recommendations

- Use the Derbyshire green color (#2d5f3f) as background
- White bin icon in center
- Square format with rounded corners
- High contrast for visibility
- Test on different backgrounds (light/dark)

## Temporary Placeholder

For now, the PWA will work without icons, but users won't see a nice icon when they install the app. Generate icons before promoting the PWA!
