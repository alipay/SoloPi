#!/usr/bin/env node
// Compatibility for previously installed development command wrappers.
import {main} from './solopi-desktop-package.mjs';
try { main(process.argv.slice(2)); } catch(error) { console.error(error.message); process.exitCode=error.exitCode || 1; }
