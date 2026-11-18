// The theme button on the front page and the help page.
import { applyStoredTheme, themeButton } from './viewer/render.js';

applyStoredTheme();
const slot = document.getElementById('theme-slot');
if (slot) slot.replaceWith(themeButton());
