// Generate app assets from the supplied logo, preserving its artwork and black background.
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const publicDir = path.join(__dirname, '..', 'public');
  const cropped = await sharp(path.join(publicDir, 'logo seul.jpg'))
    .trim({ background: '#000000', threshold: 25 })
    .png().toBuffer();
  for (const [name, size] of [['logo-pathelix.png', 512], ['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180], ['favicon.png', 48]]) {
    const inset = Math.round(size * 0.1);
    await sharp(cropped)
      .resize(size - inset * 2, size - inset * 2, { fit: 'contain', background: '#000000' })
      .extend({ top: inset, bottom: inset, left: inset, right: inset, background: '#000000' })
      .png().toFile(path.join(publicDir, name));
  }
  // Keep the historical favicon URL valid as well, using the very same artwork.
  const icon = await fs.readFile(path.join(publicDir, 'favicon.png'));
  await fs.writeFile(path.join(publicDir, 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><image width="48" height="48" href="data:image/png;base64,${icon.toString('base64')}"/></svg>\n`);
  // Open tabs and cached page bundles can still request the former SVG URLs.
  // Serve the current artwork there too, rather than breaking those pages with 404s.
  const logo = await fs.readFile(path.join(publicDir, 'logo-pathelix.png'));
  const legacySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><image width="512" height="512" href="data:image/png;base64,${logo.toString('base64')}"/></svg>\n`;
  for (const name of ['logo seul.svg', 'logo_pathelix.svg']) {
    await fs.writeFile(path.join(publicDir, name), legacySvg);
  }
  console.log('Logo, favicon and installed-app icons updated from logo seul.jpg.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
