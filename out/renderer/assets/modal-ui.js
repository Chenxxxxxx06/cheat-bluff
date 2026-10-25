// Reuse the shipped dialog's portal, focus trap, Escape and outside-interaction handling.
export function createModalView({React,Dialog,Portal,Content,Overlay,Title}) {
  const h=React.createElement;
  return function Modal({children,onDismiss,...props}) {
    const opener=React.useRef(document.activeElement);
    return h(Dialog,{open:true,onOpenChange:open=>{if(!open)onDismiss?.();}},
      h(Portal,null,h(Overlay,{className:'cx-modal-backdrop'}),
        h(Content,{...props,'aria-describedby':undefined,onCloseAutoFocus:event=>{event.preventDefault();if(opener.current?.isConnected)opener.current.focus();}},
          h(Title,{className:'sr-only'},props['aria-label']||'对话框'),children)));
  };
}
