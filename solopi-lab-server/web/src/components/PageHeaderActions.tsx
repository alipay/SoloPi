import {createContext,useContext,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
export const PageHeaderSlot=createContext<HTMLElement|null>(null);
// Each page owns its actions; the app shell owns their single visual location.
export function PageHeaderActions({children}:{children:ReactNode}){
 const host=useContext(PageHeaderSlot);
 return host?createPortal(children,host):<div className="page-header-actions">{children}</div>;
}
