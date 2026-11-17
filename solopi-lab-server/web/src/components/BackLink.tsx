import {ArrowLeft} from 'lucide-react';
import type {ReactNode} from 'react';
/** Web navigation affordance, using the existing Client icon and button palette. */
export function BackLink({href,children}:{href:string;children:ReactNode}){
 return <a className="workspace-back" href={href}><ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true"/><span>{children}</span></a>;
}
export function BackButton({onClick,children,...props}:{onClick:()=>void;children:ReactNode;'data-testid'?:string}){
 return <button {...props} type="button" className="workspace-back" onClick={onClick}><ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true"/><span>{children}</span></button>;
}
