// DSH web client - ModuleLoader self-registration format
window.__ModuleLoader__.load({
  id: 'dsh-chatroom-mvp',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const api={async get(p){const r=await fetch('/chatroom-api'+p);const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.statusText||('HTTP '+r.status));return j},async post(p,b){const r=await fetch('/chatroom-api'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.statusText||('HTTP '+r.status));return j}}

const MAX_ATTACHMENT_BYTES=20*1024*1024,MAX_ATTACHMENTS=10,IMAGE_TYPES=new Set(['image/png','image/jpeg','image/webp','image/gif'])
function createLocalId(prefix){return prefix+'-'+(globalThis.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2))}
function formatSize(bytes){if(bytes<1024)return bytes+' B';if(bytes<1048576)return(bytes/1024).toFixed(1)+' KB';return(bytes/1048576).toFixed(1)+' MB'}
function fileExtension(name){const parts=String(name||'').split('.');return(parts.length>1?parts.pop():'FILE').toUpperCase().slice(0,8)}
function isImageFile(file){return IMAGE_TYPES.has(String(file.type||'').toLowerCase())}
function uploadAttachment(roomId,file,messageId,onProgress,signal){
  return new Promise((resolve,reject)=>{
    const params=new URLSearchParams({name:file.name||'未命名文件',type:file.type||'application/octet-stream'})
    const xhr=new XMLHttpRequest()
    xhr.open('POST','/chatroom-api/rooms/'+encodeURIComponent(roomId)+'/attachments?'+params)
    xhr.setRequestHeader('Content-Type','application/octet-stream')
    xhr.responseType='json'
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress&&onProgress(e.loaded/e.total)}
    xhr.onload=()=>{const data=xhr.response||{};if(xhr.status>=200&&xhr.status<300)resolve(data);else{const error=new Error(data.error||('上传失败 (HTTP '+xhr.status+')'));error.status=xhr.status;reject(error)}}
    xhr.onerror=()=>reject(new Error('网络中断，附件尚未发送，请点击重试'))
    xhr.onabort=()=>reject(new DOMException('Upload cancelled','AbortError'))
    if(signal){if(signal.aborted){xhr.abort();return}signal.addEventListener('abort',()=>xhr.abort(),{once:true})}
    xhr.send(file)
  })
}

class ChatroomWS {
  constructor({getConnection,onMessage,onStatusChange}){this.getConnection=getConnection;this.onMessage=onMessage;this.onStatusChange=onStatusChange;this.ws=null;this.status='disconnected';this._pending=new Set();this._destroyed=false;this._connecting=false;this._timer=null;this._delay=1000;this._authenticated=false}
  async connect(){
    if(this._destroyed||this._connecting||this.ws?.readyState<=1)return
    this._connecting=true;this._authenticated=false;this._setStatus('connecting')
    try{
      const {wsPort,wsToken}=await this.getConnection()
      if(this._destroyed)return
      const socket=new WebSocket('ws://127.0.0.1:'+String(wsPort));this.ws=socket
      socket.onopen=()=>{this._delay=1000;this._setStatus('connected');socket.send(JSON.stringify({type:'auth',token:wsToken}))}
      socket.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.type==='auth_ok'){this._authenticated=true;for(const r of this._pending)this._send({type:'join_room',roomId:r})}else{this.onMessage&&this.onMessage(m)}}catch(e){}}
      socket.onclose=()=>{this._authenticated=false;if(this.ws===socket)this.ws=null;if(!this._destroyed){this._setStatus('disconnected');this._recon()}}
      socket.onerror=()=>this._setStatus('error')
    }catch(e){this._recon()}finally{this._connecting=false}
  }
  joinRoom(r){this._pending.add(r);this._send({type:'join_room',roomId:r})}
  leaveRoom(r){this._pending.delete(r);this._send({type:'leave_room',roomId:r})}
  sendMessage(r,c,t,messageId){return this._send({type:'send_message',roomId:r,content:c,tempId:t,messageId})}
  sendTyping(r,i){this._send({type:'typing',roomId:r,isTyping:i})}
  markRead(r,m){this._send({type:'read',roomId:r,messageId:m})}
  _send(m){try{if(this.ws?.readyState===1&&this._authenticated){this.ws.send(JSON.stringify(m));return true}}catch(e){}return false}
  _setStatus(s){this.status=s;this.onStatusChange&&this.onStatusChange(s)}
  _recon(){clearTimeout(this._timer);this._timer=setTimeout(()=>{this._delay=Math.min(this._delay*2,30000);this.connect()},this._delay)}
  destroy(){this._destroyed=true;clearTimeout(this._timer);if(this.ws){this.ws.onclose=null;this.ws.close()}}
}

function stringToColor(s){const c=['#5B8DEF','#3ECDA8','#F59E42','#E05252','#A664E0','#43B89C','#E06B9A','#6B9CE0','#D4A843','#60B05A'];let h=0;for(let i=0;i<(s||'').length;i++)h=s.charCodeAt(i)+((h<<5)-h);return c[Math.abs(h)%c.length]}

const S={btnPrimary:{background:'var(--dsw-alias-state-business-primary)',color:'#fff',border:'none',borderRadius:7,padding:'7px 14px',cursor:'pointer',fontSize:13,fontWeight:500,display:'flex',alignItems:'center',justifyContent:'center'},btnSecondary:{background:'var(--dsw-alias-interactive-bg-hover)',color:'var(--dsw-alias-label-primary)',border:'1px solid var(--dsw-alias-border-l2)',borderRadius:7,padding:'7px 14px',cursor:'pointer',fontSize:13,fontWeight:500,display:'flex',alignItems:'center',justifyContent:'center'},btnBack:{background:'transparent',border:'none',cursor:'pointer',padding:'4px 8px',borderRadius:6,color:'var(--dsw-alias-label-secondary)',fontSize:13},btnIcon:{background:'transparent',border:'none',cursor:'pointer',padding:'4px 8px',borderRadius:6,color:'var(--dsw-alias-label-secondary)',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center'},input:{width:'100%',padding:'8px 10px',borderRadius:7,border:'1px solid var(--dsw-alias-border-l2)',background:'var(--dsw-alias-interactive-bg-hover)',color:'var(--dsw-alias-label-primary)',fontSize:13,outline:'none',boxSizing:'border-box'}}

function Avatar({name,url,size}){size=size||32;const style={width:size,height:size,borderRadius:'50%',flexShrink:0,userSelect:'none'};if(url)return h('img',{src:url,alt:name||'头像',style:{...style,objectFit:'cover',display:'block',background:'var(--dsw-alias-interactive-bg-hover)'}});return h('div',{style:{...style,background:stringToColor(name||'?'),display:'flex',alignItems:'center',justifyContent:'center',fontSize:Math.floor(size*0.44),fontWeight:700,color:'#fff'}},(name||'?')[0].toUpperCase())}

function WsDot({status}){const color=status==='connected'?'#3ECDA8':status==='connecting'?'#F59E42':'#bbb';return h('div',{title:'WebSocket: '+status,style:{width:7,height:7,borderRadius:'50%',background:color,flexShrink:0}})}

function ChatroomPanel({ctx}){const{useState,useEffect,useRef,useCallback}=React;const[rooms,setRooms]=useState([]);const[activeRoomId,setActiveRoomId]=useState(null);const[view,setView]=useState('rooms');const[loading,setLoading]=useState(true);const[user,setUser]=useState(null);const[unread,setUnread]=useState({});const[wsStatus,setWsStatus]=useState('disconnected');const wsRef=useRef(null);const handleGlobalWsMsg=useCallback((msg)=>{if(msg.type==='new_message'&&msg.message){setUnread(u=>{const rid=msg.message.roomId;return{...u,[rid]:(u[rid]||0)+1}})}},[]);useEffect(()=>{let cancelled=false;const init=async()=>{try{let profile=null;try{const pr=await api.get('/profile');profile=pr&&pr.user}catch(e){}if(!cancelled)setUser(profile);const list=await api.get('/rooms').catch(()=>[]);if(cancelled)return;setRooms(list);if(profile){const info=await api.get('/storage-info');if(info&&info.wsPort&&!cancelled){const ws=new ChatroomWS({getConnection:()=>api.get('/storage-info'),onStatusChange:setWsStatus,onMessage:handleGlobalWsMsg});ws.connect();wsRef.current=ws;for(const room of list)ws.joinRoom(room.id)}}}catch(e){console.error('[Chatroom] init error:',e)}finally{if(!cancelled)setLoading(false)}};init();return()=>{cancelled=true;wsRef.current&&wsRef.current.destroy();wsRef.current=null}},[ctx,handleGlobalWsMsg]);const goToRoom=useCallback((roomId)=>{setActiveRoomId(roomId);setView('chat');setUnread(u=>({...u,[roomId]:0}))},[]);const activeRoom=rooms.find(r=>r.id===activeRoomId);if(loading)return h('div',{style:{padding:24,textAlign:'center',color:'var(--dsw-alias-label-secondary)',fontSize:13}},'加载中...');if(!user)return h('div',{style:{padding:'24px 16px',textAlign:'center',color:'var(--dsw-alias-label-secondary)',fontSize:14}},h('div',{style:{fontSize:32,marginBottom:12}},'💬'),h('div',{style:{fontWeight:600,marginBottom:8,color:'var(--dsw-alias-label-primary)'}},'需要登录'),h('div',null,'请先登录 DeepSeek 账号'));if(view==='profile')return h(ProfileView,{ctx,user,onBack:()=>setView('rooms'),onSaved:u=>{setUser(u);setView('rooms')}});if(view==='create')return h(CreateRoomView,{ctx,onBack:()=>setView('rooms'),onCreated:(room)=>{setRooms(p=>[room,...p]);wsRef.current&&wsRef.current.joinRoom(room.id);goToRoom(room.id)}});if(view==='join')return h(JoinRoomView,{ctx,onBack:()=>setView('rooms'),onJoined:(room)=>{setRooms(p=>p.find(r=>r.id===room.id)?p:[room,...p]);wsRef.current&&wsRef.current.joinRoom(room.id);goToRoom(room.id)}});if(view==='chat'&&activeRoom)return h(ChatView,{ctx,room:activeRoom,user,ws:wsRef.current,wsStatus,onBack:()=>{setView('rooms');setUnread(u=>({...u,[activeRoomId]:0}))}});return h('div',{style:{height:'100%',display:'flex',flexDirection:'column',background:'var(--dsw-specific-sidebar-fill)'}},h('div',{style:{padding:'12px 16px 8px',borderBottom:'1px solid var(--dsw-alias-border-l2)',flexShrink:0}},h('div',{style:{display:'flex',alignItems:'center',marginBottom:8,gap:6}},h('span',{style:{fontWeight:600,fontSize:15,color:'var(--dsw-alias-label-primary)',flex:1}},'聊天室'),h(WsDot,{status:wsStatus})),h('div',{style:{display:'flex',gap:6}},h('button',{onClick:()=>setView('create'),style:{...S.btnPrimary,flex:1}},'+ 创建'),h('button',{onClick:()=>setView('join'),style:{...S.btnSecondary,flex:1}},'加入'))),h('div',{style:{padding:'8px 16px',display:'flex',alignItems:'center',gap:8,borderBottom:'1px solid var(--dsw-alias-border-l2)',flexShrink:0}},h(Avatar,{name:user.username||'U',url:user.avatarUrl,size:28}),h('div',{style:{fontSize:13,fontWeight:500,color:'var(--dsw-alias-label-primary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1,minWidth:0}},user.username||user.email||'用户'),h('button',{onClick:()=>setView('profile'),style:S.btnIcon,title:'个人设置'},'⚙️')),h('div',{style:{flex:1,overflowY:'auto',padding:'4px 0'}},rooms.length===0?h('div',{style:{padding:'24px 16px',textAlign:'center',color:'var(--dsw-alias-label-secondary)',fontSize:13}},h('div',{style:{fontSize:28,marginBottom:8}},'🏠'),h('div',null,'还没有聊天室')):rooms.map(room=>h(RoomItem,{key:room.id,room,unread:unread[room.id]||0,onClick:()=>goToRoom(room.id)}))))}

function RoomItem({room,unread,onClick}) {
  const [hov,setHov]=React.useState(false)
  return h('button',{onClick,onMouseEnter:()=>setHov(true),onMouseLeave:()=>setHov(false),
    style:{width:'100%',padding:'8px 16px',display:'flex',alignItems:'center',gap:10,background:hov?'var(--dsw-alias-interactive-bg-hover)':'transparent',border:'none',cursor:'pointer',textAlign:'left'}},
    h('div',{style:{width:36,height:36,borderRadius:8,background:stringToColor(room.name),display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,color:'#fff',flexShrink:0}},(room.name||'?')[0].toUpperCase()),
    h('div',{style:{flex:1,minWidth:0}},h('div',{style:{fontSize:14,fontWeight:500,color:'var(--dsw-alias-label-primary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},room.name)),
    unread>0&&h('div',{style:{background:'var(--dsw-alias-state-business-primary)',color:'#fff',borderRadius:10,padding:'1px 6px',fontSize:11,fontWeight:600,flexShrink:0}},unread>99?'99+':String(unread)))
}

function ChatView({ctx,room,user,ws,wsStatus,onBack}) {
  const {useState,useEffect,useRef,useCallback}=React
  const [msgs,setMsgs]=useState([])
  const [input,setInput]=useState('')
  const [sending,setSending]=useState(false)
  const [typing,setTyping]=useState([])
  const [online,setOnline]=useState([])
  const [sub,setSub]=useState('chat')
  const [members,setMembers]=useState([])
  const [drafts,setDrafts]=useState([])
  const [sendError,setSendError]=useState('')
  const [dragActive,setDragActive]=useState(false)
  const botRef=useRef(null)
  const inRef=useRef(null)
  const fileInputRef=useRef(null)
  const ttRef=useRef(null)
  const seen=useRef(new Set())
  const draftsRef=useRef(new Map())
  const uploadOps=useRef(new Map())
  const uploadVersions=useRef(new Map())
  const retryRef=useRef(null)
  const dragDepth=useRef(0)
  const pendingSends=useRef(new Map())

  useEffect(()=>{
    let dead=false
    ;(async()=>{
      try{
        const [ms,mbs]=await Promise.all([api.get('/rooms/'+room.id+'/messages?limit=50'),api.get('/rooms/'+room.id+'/members')])
        if(dead)return
        ms.forEach(m=>seen.current.add(m.id))
        setMsgs(ms);setMembers(mbs)
        setTimeout(()=>botRef.current&&botRef.current.scrollIntoView({behavior:'auto'}),60)
      }catch(e){console.error('[Chatroom]',e)}
    })()
    return()=>{dead=true}
  },[room.id])

  const settlePendingText=useCallback((tempId,result)=>{
    const pending=pendingSends.current.get(tempId)
    if(!pending)return
    clearTimeout(pending.timer);pendingSends.current.delete(tempId);pending.resolve(result)
  },[])
  const awaitTextReceipt=useCallback(tempId=>new Promise(resolve=>{
    const timer=setTimeout(()=>{pendingSends.current.delete(tempId);resolve({timeout:true})},8000)
    pendingSends.current.set(tempId,{timer,resolve})
  }),[])
  useEffect(()=>()=>{
    for(const pending of pendingSends.current.values()){clearTimeout(pending.timer);pending.resolve({timeout:true})}
    pendingSends.current.clear()
  },[])

  useEffect(()=>{
    if(!ws)return
    const prev=ws.onMessage
    ws.onMessage=(msg)=>{
      if(msg.type==='message_error'){
        if(msg.roomId&&msg.roomId!==room.id)return
        if(msg.tempId){setMsgs(cur=>cur.filter(m=>m.id!==msg.tempId));seen.current.delete(msg.tempId);settlePendingText(msg.tempId,{error:msg.error||'发送失败，请重试'})}
        setSendError(msg.error||'发送失败，请重试');setSending(false);return
      }
      if((msg.roomId||(msg.message&&msg.message.roomId))!==room.id){prev&&prev(msg);return}
      if(msg.type==='new_message'&&msg.message){
        const m=msg.message
        if(msg.tempId)settlePendingText(msg.tempId,{message:m})
        if(!seen.current.has(m.id)){
          seen.current.add(m.id)
          setMsgs(prev=>{
            if(msg.tempId){const i=prev.findIndex(x=>x.id===msg.tempId);if(i>=0){const n=[...prev];n[i]=m;seen.current.delete(msg.tempId);return n}}
            return[...prev,m]
          })
          setTimeout(()=>botRef.current&&botRef.current.scrollIntoView({behavior:'smooth'}),40)
          ws.markRead(room.id,m.id)
        }
      }else if(msg.type==='typing'){
        setTyping(cur=>msg.isTyping
          ?cur.find(u=>u.userId===msg.userId)?cur:[...cur,{userId:msg.userId,nickname:(members.find(m=>m.userId===msg.userId)||{}).nickname||msg.userId}]
          :cur.filter(u=>u.userId!==msg.userId))
      }else if(msg.type==='user_online'||msg.type==='user_joined'){
        setOnline(cur=>cur.includes(msg.userId)?cur:[...cur,msg.userId])
      }else if(msg.type==='user_offline'||msg.type==='user_left'){
        setOnline(cur=>cur.filter(id=>id!==msg.userId));setTyping(cur=>cur.filter(u=>u.userId!==msg.userId))
      }else if(msg.type==='nickname_changed'){
        setMembers(cur=>cur.map(m=>m.userId===msg.userId?{...m,nickname:msg.nickname}:m))
        setMsgs(cur=>cur.map(m=>m.senderId===msg.userId?{...m,senderName:msg.nickname}:m))
      }else if(msg.type==='profile_changed'){
        setMembers(cur=>cur.map(m=>m.userId===msg.userId?{...m,avatarUrl:msg.avatarUrl||null}:m))
      }else{prev&&prev(msg)}
    }
    ws.joinRoom(room.id)
    return()=>{ws.onMessage=prev;ws.leaveRoom(room.id)}
  },[ws,room.id,members])

  const patchDraft=useCallback((id,patch)=>{
    const old=draftsRef.current.get(id);if(!old)return
    const next={...old,...patch};draftsRef.current.set(id,next)
    setDrafts(prev=>prev.map(item=>item.id===id?next:item))
  },[])

  const removeDraft=useCallback((id)=>{
    if(sending)return
    uploadVersions.current.set(id,(uploadVersions.current.get(id)||0)+1)
    const op=uploadOps.current.get(id);if(op){op.abort();uploadOps.current.delete(id)}
    const draft=draftsRef.current.get(id);if(!draft)return
    if(draft.previewUrl)URL.revokeObjectURL(draft.previewUrl)
    draftsRef.current.delete(id);setDrafts(prev=>prev.filter(item=>item.id!==id))
    if(draft.attachment&&!draft.attachment.messageId)fetch(draft.attachment.url,{method:'DELETE'}).catch(()=>{})
  },[sending])

  // 与原生 composer 一致：普通文件选中即后台上传，图片发送时才上传。
  const uploadDraft=useCallback(async(draft,messageId)=>{
    const version=(uploadVersions.current.get(draft.id)||0)+1
    uploadVersions.current.set(draft.id,version)
    const controller=new AbortController();uploadOps.current.set(draft.id,controller)
    patchDraft(draft.id,{status:'uploading',progress:0,error:''})
    try{
      const attachment=await uploadAttachment(room.id,draft.file,messageId,progress=>patchDraft(draft.id,{progress}),controller.signal)
      if(uploadVersions.current.get(draft.id)!==version||!draftsRef.current.has(draft.id)){
        fetch(attachment.url,{method:'DELETE'}).catch(()=>{});return null
      }
      patchDraft(draft.id,{status:'ready',progress:1,attachment,error:''})
      return attachment
    }catch(e){
      if(e&&e.name!=='AbortError'&&uploadVersions.current.get(draft.id)===version)patchDraft(draft.id,{status:'error',error:e.message||'上传失败，点击重试'})
      return null
    }finally{if(uploadOps.current.get(draft.id)===controller)uploadOps.current.delete(draft.id)}
  },[room.id,patchDraft])

  const addFiles=useCallback((files,directories)=>{
    if(sending)return
    const incoming=Array.from(files||[])
    if(!incoming.length)return
    if(incoming.some(file=>directories&&directories.has(file))){setSendError('暂不支持直接上传文件夹，请先压缩后上传');return}
    const empty=incoming.find(file=>file.size===0)
    if(empty){setSendError('不能上传空文件：'+empty.name);return}
    const tooLarge=incoming.find(file=>file.size>MAX_ATTACHMENT_BYTES)
    if(tooLarge){setSendError('「'+tooLarge.name+'」超过 20 MB，请压缩后上传');return}
    const available=MAX_ATTACHMENTS-draftsRef.current.size
    if(available<=0){setSendError('每条消息最多添加 '+MAX_ATTACHMENTS+' 个附件');return}
    if(incoming.length>available)setSendError('最多添加 '+MAX_ATTACHMENTS+' 个附件，本次仅接收前 '+available+' 个')
    else setSendError('')
    const added=incoming.slice(0,available).map(file=>({
      id:createLocalId('draft'),file,kind:isImageFile(file)?'image':'file',
      previewUrl:isImageFile(file)?URL.createObjectURL(file):null,
      status:isImageFile(file)?'ready':'uploading',progress:isImageFile(file)?1:0,attachment:null,error:''
    }))
    for(const draft of added)draftsRef.current.set(draft.id,draft)
    setDrafts(prev=>[...prev,...added])
    for(const draft of added)if(draft.kind==='file')uploadDraft(draft,null)
  },[sending,uploadDraft])

  useEffect(()=>()=>{
    for(const op of uploadOps.current.values())op.abort()
    for(const draft of draftsRef.current.values())if(draft.previewUrl)URL.revokeObjectURL(draft.previewUrl)
    draftsRef.current.clear()
  },[])

  const onPaste=useCallback(e=>{
    const files=Array.from(e.clipboardData&&e.clipboardData.files||[])
    if(!files.length)return
    if(!(e.clipboardData.getData('text/plain')))e.preventDefault()
    e.stopPropagation();addFiles(files)
  },[addFiles])

  const isFileDrag=e=>Array.from(e.dataTransfer&&e.dataTransfer.types||[]).includes('Files')
  const onDragEnter=e=>{if(!isFileDrag(e)||sending)return;e.preventDefault();e.stopPropagation();dragDepth.current++;setDragActive(true)}
  const onDragOver=e=>{if(!isFileDrag(e))return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect=sending?'none':'copy'}
  const onDragLeave=e=>{if(!isFileDrag(e))return;e.preventDefault();e.stopPropagation();dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragActive(false)}
  const onDrop=e=>{
    if(!isFileDrag(e))return;e.preventDefault();e.stopPropagation();dragDepth.current=0;setDragActive(false)
    if(sending)return
    const directories=new Set();let index=0
    for(const item of Array.from(e.dataTransfer.items||[])){
      if(item.kind!=='file')continue
      const file=e.dataTransfer.files[index++]
      if(file&&typeof item.webkitGetAsEntry==='function'&&item.webkitGetAsEntry()&&item.webkitGetAsEntry().isDirectory)directories.add(file)
    }
    addFiles(Array.from(e.dataTransfer.files||[]),directories)
  }

  const send=useCallback(async()=>{
    const text=input.trim()
    if(sending)return
    if(!text&&!drafts.length)return
    if(drafts.some(d=>d.status!=='ready')){setSendError('请等待附件上传完成，或重试、移除失败附件');return}
    clearTimeout(ttRef.current);ws&&ws.sendTyping(room.id,false)
    setSendError('')
    if(drafts.length){
      setSending(true)
      const snapshot=[...drafts]
      const signature=text+'\n'+snapshot.map(d=>d.id).join(',')
      const retry=retryRef.current&&retryRef.current.signature===signature?retryRef.current:null
      const messageId=retry?retry.messageId:createLocalId('msg')
      try{
        const uploaded=[]
        for(const draft of snapshot)uploaded.push(draft.attachment||await uploadDraft(draft,messageId))
        if(uploaded.some(file=>!file))throw new Error('附件未上传完成，请重试或移除失败附件')
        const attachmentIds=uploaded.map(file=>file.id)
        const m=await api.post('/rooms/'+encodeURIComponent(room.id)+'/messages',{content:text,attachmentIds,messageId})
        seen.current.add(m.id)
        setMsgs(prev=>prev.some(x=>x.id===m.id)?prev.map(x=>x.id===m.id?m:x):[...prev,m])
        retryRef.current=null;setInput('')
        for(const draft of draftsRef.current.values())if(draft.previewUrl)URL.revokeObjectURL(draft.previewUrl)
        draftsRef.current.clear();setDrafts([])
        setTimeout(()=>botRef.current&&botRef.current.scrollIntoView({behavior:'smooth'}),40)
      }catch(e){
        retryRef.current={signature,messageId}
        setSendError(e&&e.message||'发送失败，请重试')
      }
      setSending(false);inRef.current&&inRef.current.focus();return
    }
    setInput('');setSending(true)
    const tid='tmp-'+Date.now()
    const signature='text:'+text
    const retry=retryRef.current&&retryRef.current.signature===signature?retryRef.current:null
    const messageId=retry?retry.messageId:createLocalId('msg')
    const me=members.find(m=>m.userId===user.userId)
    const opt={id:tid,roomId:room.id,senderId:user.userId,senderName:me?me.nickname:(user.username||'Me'),content:text,type:'text',timestamp:Date.now(),readBy:[user.userId],_pending:true}
    seen.current.add(tid);setMsgs(p=>[...p,opt])
    setTimeout(()=>botRef.current&&botRef.current.scrollIntoView({behavior:'smooth'}),40)
    const ok=ws&&ws.sendMessage(room.id,text,tid,messageId)
    let receipt=ok?await awaitTextReceipt(tid):{timeout:true}
    if(receipt.timeout){
      // WebSocket 没有回执时，通过幂等 HTTP 重试确认服务器是否已收到。
      try{receipt={message:await api.post('/rooms/'+encodeURIComponent(room.id)+'/messages',{content:text,messageId,tempId:tid})}}
      catch(e){receipt={error:e&&e.message||'网络中断，请重试'}}
    }
    if(receipt.message){
      const m=receipt.message;seen.current.add(m.id)
      setMsgs(prev=>prev.some(x=>x.id===m.id)?prev.map(x=>x.id===m.id?m:x):prev.map(x=>x.id===tid?m:x))
      if(m.senderId===user.userId)settlePendingText(tid,{message:m})
      retryRef.current=null;setSendError('')
    }else{
      setMsgs(prev=>prev.filter(x=>x.id!==tid));seen.current.delete(tid);setInput(text)
      retryRef.current={signature,messageId};setSendError(receipt.error||'发送失败，请重试')
    }
    setSending(false);inRef.current&&inRef.current.focus()
  },[input,drafts,sending,ws,room.id,members,user,uploadDraft,awaitTextReceipt,settlePendingText])

  const onChange=useCallback((e)=>{
    setInput(e.target.value)
    if(!ws)return
    if(e.target.value){ws.sendTyping(room.id,true);clearTimeout(ttRef.current);ttRef.current=setTimeout(()=>ws.sendTyping(room.id,false),3000)}
    else{clearTimeout(ttRef.current);ws.sendTyping(room.id,false)}
  },[ws,room.id])

  if(sub==='members')return h(MembersView,{ctx,room,members,user,onBack:()=>setSub('chat'),onUpdate:setMembers})
  if(sub==='invite')return h(InviteView,{ctx,room,onBack:()=>setSub('chat')})

  return h('div',{style:{height:'100%',display:'flex',flexDirection:'column',background:'var(--dsw-specific-sidebar-fill)',position:'relative'},onDragEnter,onDragOver,onDragLeave,onDrop},
    dragActive&&h('div',{style:{position:'absolute',inset:12,zIndex:20,pointerEvents:'none',display:'flex',alignItems:'center',justifyContent:'center',border:'2px dashed var(--dsw-alias-state-business-primary)',borderRadius:14,background:'var(--dsw-specific-sidebar-fill)',opacity:.96}},
      h('div',{style:{textAlign:'center',color:'var(--dsw-alias-label-primary)'}},h('div',{style:{fontSize:32,marginBottom:8}},'📎'),h('div',{style:{fontSize:14,fontWeight:600}},'拖放到这里添加附件'),h('div',{style:{fontSize:12,color:'var(--dsw-alias-label-secondary)',marginTop:6}},'单文件最大 20 MB，每条消息最多 10 个'))),
    h('div',{style:{padding:'10px 12px',borderBottom:'1px solid var(--dsw-alias-border-l2)',display:'flex',alignItems:'center',gap:6,flexShrink:0}},
      h('button',{onClick:onBack,style:S.btnBack},'←'),
      h('div',{style:{flex:1,minWidth:0}},
        h('div',{style:{fontWeight:600,fontSize:14,color:'var(--dsw-alias-label-primary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},room.name),
        online.length>0&&h('div',{style:{fontSize:11,color:'var(--dsw-alias-label-secondary)',marginTop:1}},online.length+' 人在线')),
      h(WsDot,{status:wsStatus}),
      h('button',{onClick:()=>setSub('invite'),style:S.btnIcon,title:'邀请'},'🔗'),
      h('button',{onClick:()=>setSub('members'),style:S.btnIcon,title:'成员 '+members.length},'👥')),
    h('div',{style:{flex:1,overflowY:'auto',padding:'8px 12px',display:'flex',flexDirection:'column',gap:6}},
      msgs.length===0?h('div',{style:{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--dsw-alias-label-secondary)',fontSize:13}},'暂无消息，发送第一条消息吧！')
        :msgs.map(m=>h(MsgBubble,{key:m.id,msg:m,isSelf:m.senderId===user.userId,senderAvatar:(members.find(x=>x.userId===m.senderId)||{}).avatarUrl})),
      h('div',{ref:botRef})),
    typing.length>0&&h('div',{style:{padding:'2px 16px 4px',fontSize:12,color:'var(--dsw-alias-label-secondary)',flexShrink:0}},typing.map(u=>u.nickname).join('、')+' 正在输入...'),
    h('div',{style:{padding:'8px 12px',borderTop:'1px solid var(--dsw-alias-border-l2)',display:'flex',flexDirection:'column',gap:8,flexShrink:0}},
      drafts.length>0&&h(DraftAttachments,{drafts,onRemove:removeDraft,onRetry:draft=>{if(!sending)uploadDraft(draft,null)},disabled:sending}),
      sendError&&h('div',{role:'alert',style:{fontSize:12,lineHeight:1.5,color:'var(--dsw-alias-state-danger,#d54941)',overflowWrap:'anywhere'}},sendError),
      h('div',{style:{display:'flex',gap:8,alignItems:'flex-end'}},
        h('button',{type:'button',onMouseDown:e=>e.preventDefault(),onClick:()=>fileInputRef.current&&fileInputRef.current.click(),disabled:sending,title:'添加图片或文件（也可粘贴、拖放）','aria-label':'添加图片或文件',style:{...S.btnSecondary,padding:0,width:34,height:34,flexShrink:0,opacity:sending?.5:1}},'+'),
        h('input',{ref:fileInputRef,type:'file',multiple:true,hidden:true,disabled:sending,onChange:e=>{const files=Array.from(e.target.files||[]);e.target.value='';addFiles(files)}}),
        h('textarea',{ref:inRef,value:input,onChange,onPaste,readOnly:sending,onKeyDown:(e)=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send()}},
          placeholder:wsStatus==='connected'?'发送消息，可粘贴图片或拖入文件...':'连接中...（仍可添加附件）',rows:1,
          style:{...S.input,flex:1,resize:'none',maxHeight:100,minWidth:0,fontFamily:'inherit',lineHeight:'1.5'}}),
        h('button',{onClick:send,disabled:sending||(!input.trim()&&!drafts.length)||drafts.some(d=>d.status!=='ready'),style:{...S.btnPrimary,padding:'7px 14px',flexShrink:0,opacity:(sending||(!input.trim()&&!drafts.length)||drafts.some(d=>d.status!=='ready'))?0.5:1}},sending?'发送中...':'发送')),
      h('div',{style:{fontSize:11,color:'var(--dsw-alias-label-secondary)',lineHeight:1.4}},drafts.some(d=>d.status==='uploading')?'附件上传完成后即可发送':drafts.some(d=>d.status==='error')?'附件上传失败，点击文件卡片重试':'Enter 发送 · Shift+Enter 换行 · 单文件最大 20 MB')))
}

function DraftAttachments({drafts,onRemove,onRetry,disabled}) {
  const [preview,setPreview]=React.useState(null)
  return h(React.Fragment,null,
    h('div',{role:'group','aria-label':'待发送附件',style:{display:'flex',gap:8,overflowX:'auto',padding:'2px 2px 6px',minWidth:0}},
      drafts.map(draft=>draft.kind==='image'
        ?h('div',{key:draft.id,style:{position:'relative',width:64,height:64,flexShrink:0}},
          h('button',{type:'button',disabled,onClick:()=>draft.status==='error'?onRetry(draft):setPreview(draft),title:draft.status==='error'?'点击重试上传：'+draft.file.name:draft.file.name,style:{width:64,height:64,padding:0,border:'1px solid '+(draft.status==='error'?'var(--dsw-alias-state-danger,#d54941)':'var(--dsw-alias-border-l2)'),borderRadius:12,overflow:'hidden',cursor:draft.status==='error'?'pointer':'zoom-in',background:'var(--dsw-alias-interactive-bg-hover)'}},
            h('img',{src:draft.previewUrl,alt:draft.file.name,style:{width:'100%',height:'100%',objectFit:'cover',display:'block'}}),
            draft.status==='uploading'&&h('span',{style:{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.45)',color:'#fff',fontSize:11}},Math.round(draft.progress*100)+'%'),
            draft.status==='error'&&h('span',{style:{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,.62)',color:'#fff',fontSize:11}},'重试')),
          h('button',{type:'button',disabled,onClick:()=>onRemove(draft.id),'aria-label':'移除 '+draft.file.name,title:'移除',style:{position:'absolute',top:3,right:3,width:19,height:19,padding:0,border:'none',borderRadius:'50%',background:'rgba(0,0,0,.72)',color:'#fff',fontSize:14,lineHeight:'18px',cursor:'pointer'}},'×'))
        :h('div',{key:draft.id,style:{position:'relative',width:220,height:64,flexShrink:0,display:'flex',alignItems:'center',gap:9,padding:'8px 12px',boxSizing:'border-box',border:'1px solid '+(draft.status==='error'?'var(--dsw-alias-state-danger,#d54941)':'var(--dsw-alias-border-l2)'),borderRadius:12,background:'var(--dsw-alias-interactive-bg-hover)'}},
          h('div',{style:{width:32,height:36,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:6,background:'var(--dsw-alias-state-business-primary)',color:'#fff',fontSize:9,fontWeight:700,flexShrink:0}},draft.status==='uploading'?'…':fileExtension(draft.file.name)),
          h('button',{type:'button',disabled:disabled||draft.status==='uploading',onClick:()=>draft.status==='error'&&onRetry(draft),title:draft.status==='error'?'点击重试上传':draft.file.name,style:{flex:1,minWidth:0,textAlign:'left',padding:0,border:'none',background:'none',cursor:draft.status==='error'?'pointer':'default',color:'var(--dsw-alias-label-primary)'}},
            h('div',{style:{fontSize:12,fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},draft.file.name),
            h('div',{style:{fontSize:11,marginTop:3,color:draft.status==='error'?'var(--dsw-alias-state-danger,#d54941)':'var(--dsw-alias-label-secondary)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},draft.status==='uploading'?'上传中 '+Math.round(draft.progress*100)+'%':draft.status==='error'?'上传失败，点击重试':formatSize(draft.file.size))),
          h('button',{type:'button',disabled,onClick:()=>onRemove(draft.id),'aria-label':'移除 '+draft.file.name,title:'移除',style:{position:'absolute',top:3,right:3,width:19,height:19,padding:0,border:'none',borderRadius:'50%',background:'rgba(0,0,0,.58)',color:'#fff',fontSize:14,lineHeight:'18px',cursor:'pointer'}},'×'),
          draft.status==='uploading'&&h('div',{style:{position:'absolute',bottom:0,left:12,right:12,height:2,borderRadius:2,background:'var(--dsw-alias-border-l2)'}},h('div',{style:{height:'100%',width:(draft.progress*100)+'%',background:'var(--dsw-alias-state-business-primary)',borderRadius:2}})) )) ),
    preview&&h(ImagePreview,{src:preview.previewUrl,name:preview.file.name,onClose:()=>setPreview(null)}))
}

function ImagePreview({src,name,onClose}) {
  const {useEffect,useRef}=React
  const closeRef=useRef(null)
  useEffect(()=>{
    const previous=document.activeElement
    const onKey=e=>{if(e.key==='Escape')onClose()}
    document.addEventListener('keydown',onKey)
    if(closeRef.current)closeRef.current.focus()
    return()=>{document.removeEventListener('keydown',onKey);if(previous&&previous.focus)previous.focus()}
  },[onClose])
  return h('div',{role:'dialog','aria-modal':'true','aria-label':name||'图片预览',onClick:onClose,style:{position:'fixed',inset:0,zIndex:100000,display:'flex',alignItems:'center',justifyContent:'center',padding:32,boxSizing:'border-box',background:'rgba(0,0,0,.84)'}},
    h('button',{ref:closeRef,type:'button',onClick:onClose,'aria-label':'关闭图片预览',style:{position:'absolute',top:18,right:20,width:36,height:36,border:'none',borderRadius:'50%',background:'rgba(255,255,255,.16)',color:'#fff',fontSize:25,cursor:'pointer'}},'×'),
    h('img',{src,alt:name||'图片',onClick:e=>e.stopPropagation(),style:{maxWidth:'100%',maxHeight:'100%',objectFit:'contain',borderRadius:6}}))
}

function HistoryImage({file,onPreview}) {
  const [error,setError]=React.useState(false)
  const [attempt,setAttempt]=React.useState(0)
  const src=file.url+(attempt?'?retry='+attempt:'')
  return h('div',{style:{width:210,maxWidth:'100%',height:150,borderRadius:12,overflow:'hidden',border:'1px solid var(--dsw-alias-border-l2)',background:'var(--dsw-alias-interactive-bg-hover)'}},
    error?h('div',{style:{height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,fontSize:12,color:'var(--dsw-alias-label-secondary)'}},h('span',null,'图片加载失败'),h('button',{type:'button',style:{...S.btnSecondary,padding:'4px 10px'},onClick:()=>{setError(false);setAttempt(n=>n+1)}},'重新加载'))
      :h('button',{type:'button',onClick:onPreview,title:'查看原图：'+file.fileName,style:{width:'100%',height:'100%',padding:0,border:'none',cursor:'zoom-in',background:'transparent'}},h('img',{src,alt:file.fileName,loading:'lazy',onError:()=>setError(true),style:{width:'100%',height:'100%',objectFit:'cover',display:'block'}})))
}

function MessageAttachments({attachments}) {
  const [preview,setPreview]=React.useState(null)
  const images=attachments.filter(file=>file.mimeType&&file.mimeType.startsWith('image/'))
  const files=attachments.filter(file=>!file.mimeType||!file.mimeType.startsWith('image/'))
  return h('div',{style:{display:'flex',flexDirection:'column',gap:6,maxWidth:'100%'}},
    images.length>0&&h('div',{style:{display:'grid',gridTemplateColumns:images.length>1?'repeat(2, minmax(0, 128px))':'minmax(0, 210px)',gap:6}},images.map(file=>h(HistoryImage,{key:file.id,file,onPreview:()=>setPreview(file)}))),
    files.map(file=>h('a',{key:file.id,href:file.url+'?download=1',download:file.fileName,title:'下载 '+file.fileName,style:{display:'flex',alignItems:'center',gap:9,padding:'9px 10px',borderRadius:10,textDecoration:'none',background:'var(--dsw-alias-interactive-bg-hover)',color:'var(--dsw-alias-label-primary)',border:'1px solid var(--dsw-alias-border-l2)',minWidth:0,maxWidth:260,boxSizing:'border-box'}},
      h('span',{style:{width:32,height:36,borderRadius:6,background:'var(--dsw-alias-state-business-primary)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,flexShrink:0}},fileExtension(file.fileName)),
      h('span',{style:{minWidth:0,flex:1}},h('span',{style:{fontSize:12,fontWeight:500,display:'block',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}},file.fileName),h('span',{style:{fontSize:11,color:'var(--dsw-alias-label-secondary)',display:'block',marginTop:3}},formatSize(file.fileSize)+' · 点击下载')))),
    preview&&h(ImagePreview,{src:preview.url,name:preview.fileName,onClose:()=>setPreview(null)}))
}

function MsgBubble({msg,isSelf,senderAvatar}) {
  const t=new Date(msg.timestamp).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})
  return h('div',{style:{display:'flex',flexDirection:isSelf?'row-reverse':'row',gap:6,alignItems:'flex-end',opacity:msg._pending?0.65:1}},
    h(Avatar,{name:msg.senderName||'U',url:msg.senderAvatar||senderAvatar,size:28}),
    h('div',{style:{maxWidth:'75%',display:'flex',flexDirection:'column',alignItems:isSelf?'flex-end':'flex-start',gap:2}},
      h('div',{style:{fontSize:11,color:'var(--dsw-alias-label-secondary)',padding:'0 2px'}},isSelf?t:(msg.senderName+'  '+t)),
      msg.attachments&&msg.attachments.length>0&&h(MessageAttachments,{attachments:msg.attachments}),
      msg.content&&h('div',{style:{padding:'7px 10px',borderRadius:isSelf?'12px 4px 12px 12px':'4px 12px 12px 12px',
        background:isSelf?'var(--dsw-alias-state-business-primary)':'var(--dsw-alias-interactive-bg-hover)',
        color:isSelf?'#fff':'var(--dsw-alias-label-primary)',fontSize:13,lineHeight:1.5,wordBreak:'break-word',whiteSpace:'pre-wrap'}},msg.content),
      msg._pending&&h('div',{style:{fontSize:11,color:'var(--dsw-alias-label-secondary)'}},'发送中...')))
}

function ProfileView({ctx,user,onBack,onSaved}) {
  const {useState,useRef}=React
  const [nick,setNick]=useState(user.username||'')
  const [file,setFile]=useState(null)
  const [preview,setPreview]=useState(null)
  const [loading,setLoading]=useState(false)
  const [err,setErr]=useState('')
  const inputRef=useRef(null)
  const pick=e=>{
    const f=e.target.files&&e.target.files[0]
    e.target.value=''
    if(!f)return
    if(!['image/png','image/jpeg','image/webp','image/gif'].includes(f.type)){setErr('头像仅支持 PNG、JPEG、WebP、GIF');return}
    if(f.size>5*1024*1024){setErr('头像不能超过 5 MB');return}
    if(f.size===0){setErr('不能上传空文件');return}
    if(preview)URL.revokeObjectURL(preview)
    setFile(f);setPreview(URL.createObjectURL(f));setErr('')
  }
  const save=async()=>{
    const name=nick.trim()
    if(!name){setErr('昵称不能为空');return}
    setLoading(true);setErr('')
    try{
      if(file){
        const r=await fetch('/chatroom-api/profile/avatar?type='+encodeURIComponent(file.type),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file})
        const j=await r.json().catch(()=>({}))
        if(!r.ok)throw new Error(j.error||'头像上传失败')
      }
      const saved=(await api.post('/profile',{nickname:name})).user
      if(preview)URL.revokeObjectURL(preview)
      onSaved(saved)
    }catch(e){setErr(e&&e.message||'保存失败');setLoading(false)}
  }
  const shown=preview||user.avatarUrl
  return h('div',{style:{padding:16,display:'flex',flexDirection:'column',gap:14}},
    h('div',{style:{display:'flex',alignItems:'center',gap:8}},
      h('button',{onClick:onBack,style:S.btnBack},'← 返回'),
      h('span',{style:{fontWeight:600,fontSize:15,color:'var(--dsw-alias-label-primary)'}},'个人设置')),
    h('div',{style:{display:'flex',flexDirection:'column',alignItems:'center',gap:8,padding:'8px 0'}},
      h('button',{type:'button',onClick:()=>inputRef.current&&inputRef.current.click(),title:'点击更换头像',style:{padding:0,border:'none',background:'transparent',cursor:'pointer',position:'relative'}},
        h(Avatar,{name:nick||user.username,url:shown,size:72}),
        h('span',{style:{position:'absolute',right:-2,bottom:-2,width:22,height:22,borderRadius:'50%',background:'var(--dsw-alias-state-business-primary)',color:'#fff',fontSize:12,display:'flex',alignItems:'center',justifyContent:'center',border:'2px solid var(--dsw-specific-sidebar-fill)'}},'📷')),
      h('div',{style:{fontSize:11,color:'var(--dsw-alias-label-secondary)'}},'点击头像更换 · PNG/JPEG/WebP/GIF · 最大 5 MB'),
      h('input',{ref:inputRef,type:'file',accept:'image/png,image/jpeg,image/webp,image/gif',style:{display:'none'},onChange:pick})),
    h('label',{style:{display:'flex',flexDirection:'column',gap:6}},
      h('span',{style:{fontSize:13,color:'var(--dsw-alias-label-secondary)'}},'昵称'),
      h('input',{type:'text',value:nick,onChange:e=>setNick(e.target.value),onKeyDown:e=>e.key==='Enter'&&save(),maxLength:30,placeholder:'输入昵称...',style:S.input})),
    err&&h('div',{role:'alert',style:{color:'var(--dsw-alias-state-danger)',fontSize:13}},err),
    h('button',{onClick:save,disabled:loading||!nick.trim(),style:{...S.btnPrimary,opacity:(loading||!nick.trim())?0.5:1}},loading?'保存中...':'保存'),
    h('div',{style:{fontSize:12,color:'var(--dsw-alias-label-secondary)',lineHeight:1.6}},'昵称和头像对所有已加入的聊天室生效，成员会实时看到更新。'))
}

function CreateRoomView({ctx,onBack,onCreated}) {
  const {useState}=React
  const [name,setName]=useState('')
  const [loading,setLoading]=useState(false)
  const [err,setErr]=useState('')
  const go=async()=>{
    if(!name.trim()){setErr('请输入聊天室名称');return}
    setLoading(true);setErr('')
    try{onCreated(await api.post('/rooms',{name:name.trim()}))}
    catch(e){setErr(e&&e.message||'创建失败');setLoading(false)}
  }
  return h('div',{style:{padding:16,display:'flex',flexDirection:'column',gap:12}},
    h('div',{style:{display:'flex',alignItems:'center',gap:8}},
      h('button',{onClick:onBack,style:S.btnBack},'← 返回'),
      h('span',{style:{fontWeight:600,fontSize:15,color:'var(--dsw-alias-label-primary)'}},'创建聊天室')),
    h('label',{style:{display:'flex',flexDirection:'column',gap:6}},
      h('span',{style:{fontSize:13,color:'var(--dsw-alias-label-secondary)'}},'聊天室名称'),
      h('input',{type:'text',value:name,onChange:e=>setName(e.target.value),onKeyDown:e=>e.key==='Enter'&&go(),placeholder:'输入名称...',maxLength:30,autoFocus:true,style:S.input})),
    err&&h('div',{style:{color:'var(--dsw-alias-state-danger)',fontSize:13}},err),
    h('button',{onClick:go,disabled:loading||!name.trim(),style:{...S.btnPrimary,opacity:(loading||!name.trim())?0.5:1}},loading?'创建中...':'创建聊天室'),
    h('div',{style:{marginTop:8,padding:12,borderRadius:8,background:'var(--dsw-alias-interactive-bg-hover)',fontSize:13,color:'var(--dsw-alias-label-secondary)'}},
      h('div',{style:{fontWeight:500,marginBottom:4}},'创建后可以:'),
      h('div',null,'• 分享邀请码邀请好友'),
      h('div',null,'• 实时收发消息'),
      h('div',null,'• 修改自己的备注名称')))
}

function JoinRoomView({ctx,onBack,onJoined}) {
  const {useState}=React
  const [code,setCode]=useState('')
  const [loading,setLoading]=useState(false)
  const [err,setErr]=useState('')
  const go=async()=>{
    if(code.trim().length!==6){setErr('请输入6位邀请码');return}
    setLoading(true);setErr('')
    try{onJoined(await api.post('/join',{code:code.trim().toUpperCase()}))}
    catch(e){setErr(e&&e.message||'加入失败，请检查邀请码');setLoading(false)}
  }
  return h('div',{style:{padding:16,display:'flex',flexDirection:'column',gap:12}},
    h('div',{style:{display:'flex',alignItems:'center',gap:8}},
      h('button',{onClick:onBack,style:S.btnBack},'← 返回'),
      h('span',{style:{fontWeight:600,fontSize:15,color:'var(--dsw-alias-label-primary)'}},'加入聊天室')),
    h('label',{style:{display:'flex',flexDirection:'column',gap:6}},
      h('span',{style:{fontSize:13,color:'var(--dsw-alias-label-secondary)'}},'邀请码（6位）'),
      h('input',{type:'text',value:code,onChange:e=>setCode(e.target.value.toUpperCase()),onKeyDown:e=>e.key==='Enter'&&go(),placeholder:'例如: ABC123',maxLength:6,autoFocus:true,style:{...S.input,letterSpacing:'0.2em',fontWeight:600,fontSize:18,textAlign:'center'}})),
    err&&h('div',{style:{color:'var(--dsw-alias-state-danger)',fontSize:13}},err),
    h('button',{onClick:go,disabled:loading||code.trim().length!==6,style:{...S.btnPrimary,opacity:(loading||code.trim().length!==6)?0.5:1}},loading?'加入中...':'加入聊天室'))
}

function MembersView({ctx,room,members,user,onBack,onUpdate}) {
  const {useState}=React
  const [eid,setEid]=useState(null)
  const [nick,setNick]=useState('')
  const save=async(roomId)=>{
    if(!nick.trim())return
    try{await api.post('/rooms/'+roomId+'/nickname',{nickname:nick.trim()});onUpdate(members.map(m=>m.userId===user.userId?{...m,nickname:nick.trim()}:m));setEid(null)}
    catch(e){alert(e&&e.message||'修改失败')}
  }
  return h('div',{style:{height:'100%',display:'flex',flexDirection:'column'}},
    h('div',{style:{padding:'10px 16px',borderBottom:'1px solid var(--dsw-alias-border-l2)',display:'flex',alignItems:'center',gap:8}},
      h('button',{onClick:onBack,style:S.btnBack},'←'),
      h('span',{style:{fontWeight:600,fontSize:14,color:'var(--dsw-alias-label-primary)'}},'成员 ('+members.length+')')),
    h('div',{style:{flex:1,overflowY:'auto',padding:'8px 0'}},
      members.map(mb=>{
        const isMe=mb.userId===user.userId,isEdit=eid===mb.userId&&isMe
        return h('div',{key:mb.userId,style:{padding:'8px 16px',display:'flex',alignItems:'center',gap:10}},
          h(Avatar,{name:mb.nickname,url:mb.avatarUrl,size:32}),
          h('div',{style:{flex:1,minWidth:0}},
            isEdit?h('div',{style:{display:'flex',gap:6}},
                h('input',{type:'text',value:nick,onChange:e=>setNick(e.target.value),onKeyDown:e=>e.key==='Enter'&&save(mb.roomId),autoFocus:true,style:{...S.input,flex:1,padding:'4px 8px',fontSize:13}}),
                h('button',{onClick:()=>save(mb.roomId),style:{...S.btnPrimary,padding:'4px 8px',fontSize:12}},'保存'),
                h('button',{onClick:()=>setEid(null),style:{...S.btnSecondary,padding:'4px 8px',fontSize:12}},'取消'))
              :h('div',{style:{fontSize:13,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'var(--dsw-alias-label-primary)'}},mb.nickname),
            h('div',{style:{fontSize:11,color:'var(--dsw-alias-label-secondary)',marginTop:1}},mb.role==='owner'?'👑 创建者':mb.role==='admin'?'⚡ 管理员':'成员')),
          isMe&&!isEdit&&h('button',{onClick:()=>{setNick(mb.nickname);setEid(mb.userId)},style:{...S.btnIcon,fontSize:12},title:'修改备注'},'✏️'))})))
}

function InviteView({ctx,room,onBack}) {
  const {useState}=React
  const [code,setCode]=useState(room&&room.inviteCode||'')
  const [copied,setCopied]=useState(false)
  const [loading,setLoading]=useState(false)
  const copy=async()=>{try{await navigator.clipboard.writeText(code);setCopied(true);setTimeout(()=>setCopied(false),2000)}catch(e){}}
  const refresh=async()=>{
    setLoading(true)
    try{setCode((await api.post('/rooms/'+room.id+'/invite/refresh',{})).code)}
    catch(e){alert(e&&e.message||'刷新失败')}
    setLoading(false)
  }
  return h('div',{style:{padding:16,display:'flex',flexDirection:'column',gap:16}},
    h('div',{style:{display:'flex',alignItems:'center',gap:8}},
      h('button',{onClick:onBack,style:S.btnBack},'←'),
      h('span',{style:{fontWeight:600,fontSize:15,color:'var(--dsw-alias-label-primary)'}},'邀请成员')),
    h('div',{style:{padding:16,borderRadius:10,border:'1px solid var(--dsw-alias-border-l2)',display:'flex',flexDirection:'column',gap:12}},
      h('div',{style:{fontSize:13,color:'var(--dsw-alias-label-secondary)'}},'邀请码'),
      h('div',{style:{fontSize:28,fontWeight:800,letterSpacing:'0.25em',textAlign:'center',padding:'12px',background:'var(--dsw-alias-interactive-bg-hover)',borderRadius:8,color:'var(--dsw-alias-label-primary)'}},code),
      h('div',{style:{display:'flex',gap:8}},
        h('button',{onClick:copy,style:{...S.btnPrimary,flex:1}},copied?'✓ 已复制':'复制邀请码'),
        h('button',{onClick:refresh,disabled:loading,style:{...S.btnSecondary,opacity:loading?0.5:1}},'🔄'))),
    h('div',{style:{fontSize:13,color:'var(--dsw-alias-label-secondary)',lineHeight:1.6}},'把邀请码分享给好友，在「加入聊天室」页面输入即可加入。'))
}

    return {
      inject: ['slots'],
      apply(ctx) {
        // 槽位由 ui-sidebar 声明，启动顺序不保证；未声明时重试直到可用
        let mainDone = false, panelDone = false
        const tryRegister = () => {
          if (!mainDone) {
            try {
              ctx.slots.register({
                name: 'main',
                key: 'chatroom',
                inject: () => ({})
              }, (p) => h(ChatroomPanel, {...p, ctx}))
              mainDone = true
            } catch(e) { /* 槽位未声明，稍后重试 */ }
          }
          if (!panelDone) {
            try {
              ctx.slots.register({
                name: 'sidebar.panellist',
                id: 'chatroom',
                order: 50,
                label: 'Chatroom'
              }, () => h('svg', {width:16,height:16,viewBox:'0 0 20 20',fill:'currentColor'}, h('path',{fillRule:'evenodd',d:'M2 5a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H6l-4 4V5z'})))
              panelDone = true
            } catch(e) { /* 槽位未声明，稍后重试 */ }
          }
          return mainDone && panelDone
        }
        if (!tryRegister()) {
          const timer = setInterval(() => { if (tryRegister()) clearInterval(timer) }, 500)
          setTimeout(() => clearInterval(timer), 60000)
          try { ctx.effect(() => () => clearInterval(timer), 'chatroom: register retry') } catch(e) {}
        }
      }
    }
  }
})
