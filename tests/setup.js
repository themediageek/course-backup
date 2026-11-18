// Gives Node the browser pieces the shared library expects.
import { DOMParser } from 'linkedom';

if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
