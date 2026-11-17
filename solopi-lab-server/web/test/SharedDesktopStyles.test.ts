import{readFileSync}from'node:fs';import{describe,it,expect}from'vitest';
import postcss from 'postcss';
describe('shared Desktop style isolation',()=>{
 const css=readFileSync('.desktop-chat.css','utf8');const root=postcss.parse(css);
 it('includes Desktop base defaults required by centered transforms, shadows and theme',()=>{
  for(const declaration of ['--tw-rotate: 0','--tw-skew-x: 0','--tw-scale-x: 1','--tw-scale-y: 1','--tw-ring-offset-width: 0px','--background: 0 0% 100%'])expect(css).toContain(declaration);
 });
 it('scopes base resets and utilities to both chat and portal without global selectors',()=>{
  root.walkRules(rule=>{if(rule.parent?.type==='atrule'&&/keyframes/.test((rule.parent as any).name))return;expect(rule.selector).toMatch(/#server-superagent|#server-agent-extensions/);});
  const buttonReset=root.nodes.flatMap((n:any)=>n.type==='rule'&&n.selector.includes('#server-agent-extensions')&&/button/.test(n.selector)?[n]:[]);
  expect(buttonReset.some((r:any)=>r.nodes.some((n:any)=>n.prop==='background-color'&&n.value==='transparent'))).toBe(true);
 });
});
