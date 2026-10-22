#!/usr/bin/env node
import { install } from './install-solopi-desktop-package-command.mjs';
try { console.log(JSON.stringify(install())); } catch (error) { console.error(error.message); process.exitCode = 1; }
