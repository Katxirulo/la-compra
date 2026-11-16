"use strict";
/* Lectura del ticket: modelos por defecto, llamada al servicio de IA y reparto en líneas.
   Va en fichero aparte para poder ajustarlo sin tocar el resto de la app. */
const AI_DEF={gemini:"gemini-2.5-flash",anthropic:"claude-haiku-4-5"};

const aiCfg=()=>D.settings.v||{};
const aiReady=()=>!!aiCfg().key;
async function aiJson(prompt,blob){
  const c=aiCfg(),prov=c.provider||"gemini",model=c.model||AI_DEF[prov],data=await blobB64(blob),mime=blob.type||"image/jpeg";
  let r,text="";
  try{
    if(prov==="anthropic"){
      r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"content-type":"application/json","x-api-key":c.key,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({model,max_tokens:8000,messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:mime,data}},{type:"text",text:prompt}]}]})});
      if(r.ok)text=((await r.json()).content||[]).filter(x=>x.type==="text").map(x=>x.text).join("");
    }else{
      r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",headers:{"content-type":"application/json","x-goog-api-key":c.key},
        body:JSON.stringify({contents:[{parts:[{text:prompt},{inline_data:{mime_type:mime,data}}]}],generationConfig:{responseMimeType:"application/json"}})});
      if(r.ok)text=(((await r.json()).candidates||[])[0]?.content?.parts||[]).map(x=>x.text||"").join("");
    }
  }catch(e){throw {code:"net"};}
  if(!r.ok)throw {code:r.status===401||r.status===403?"auth":r.status===404?"model":r.status===429?"limit":r.status===400?"bad":"net",status:r.status};
  const a=text.indexOf("{"),b=text.lastIndexOf("}");
  try{return JSON.parse(text.slice(a,b+1));}catch(e){throw {code:"parse"};}
}

async function readTicket(){
  if(!fin||!aiReady()||!(fin.blob||fin.ticket))return;
  syncLines();const btn=$("finOcrBtn"),msg=$("finOcrMsg");btn.disabled=true;msg.hidden=false;msg.textContent="Leyendo el ticket… suele tardar medio minuto.";
  const catalog=S.products.map(p=>p.id+" | "+p.name).join("\n");
  const prompt="La imagen es un ticket de compra de un supermercado español ("+SNAME[$("finStore").value]+"): puede ser la foto de un ticket de papel o una captura del ticket digital de la app del súper, con columnas como descripción, cantidad, precio y total. Extrae sus datos.\n"+
   "Responde SOLO con un objeto JSON con esta forma exacta:\n"+
   '{"total": 23.45, "fecha": "2026-01-31", "lineas": [{"texto": "LECHE ENT. HAC 1L", "nombre": "Leche entera 1 L", "productId": "abc", "unidades": 2, "precio": 0.95, "importe": 1.90}]}\n'+
   "- total: importe total pagado, número con punto decimal; si en la imagen no se ve el total, la suma de los importes de las líneas.\n- fecha: fecha del ticket en formato AAAA-MM-DD, o null si no se lee.\n"+
   "- lineas: una por cada artículo del ticket, sin omitir ninguno. texto: el nombre como aparece. nombre: el mismo artículo escrito de forma legible, sin abreviaturas, en minúsculas con mayúscula inicial. unidades: la cantidad; en productos al peso, los kilos (por ejemplo 0.815). precio: precio por unidad, o por kilo si va al peso. importe: lo cobrado en total por esa línea.\n"+
   "- Si debajo de un artículo hay una línea de descuento con importe negativo, no la pongas como línea aparte: réstala del importe de ese artículo y recalcula su precio.\n"+
   "- Todos los números van como números JSON con punto decimal, sin símbolo de euro.\n"+
   "- productId: el id del producto del catálogo que corresponde a esa línea, o null si ninguno encaja con claridad. No inventes ids.\n"+
   "No incluyas bolsas de la compra, descuentos globales ni líneas de IVA como productos.\n\nCatálogo (id | nombre):\n"+(catalog||"(vacío)");
  try{
    if(!fin.blob){const g=await fetch(api(fin.ticket),{headers:hdr({Accept:"application/vnd.github.raw+json"})});if(!g.ok)throw {code:"net"};fin.small=new Blob([await g.blob()],{type:"image/jpeg"});}
    fin.small=fin.small||await shrink(fin.blob);
    const r=await aiJson(prompt,fin.small);
    const ids=new Set(S.products.map(p=>p.id));
    const lines=(Array.isArray(r?.lineas)?r.lineas:[]).map(l=>{const q=num(l.unidades)>0?Math.round(num(l.unidades)*1000)/1000:1,imp=num(l.importe),pr=imp>0?imp/q:num(l.precio);
      const pid=ids.has(l.productId)?l.productId:"";
      return {name:String((pid?prodById(pid).name:l.nombre)||l.texto||"").slice(0,80),pid,qty:q,price:pr>0?pr.toFixed(2).replace(".",","):""};}).filter(l=>l.name);
    if(lines.length)fin.lines=lines;
    if(num(r?.total)>0)$("finTotal").value=num(r.total).toFixed(2).replace(".",",");
    if(/^\d{4}-\d{2}-\d{2}$/.test(r?.fecha||""))$("finDate").value=r.fecha;
    drawLines();
    const un=fin.lines.filter(l=>!l.pid).length;
    msg.textContent=lines.length?"Leído: "+lines.length+(lines.length===1?" artículo":" artículos")+". Revisa el total y los precios."+(un?" "+un+(un===1?" no está":" no están")+" en la lista maestra: se "+(un===1?"añadirá":"añadirán")+" al guardar, o elige a qué producto "+(un===1?"corresponde":"corresponden")+".":""):"No he podido sacar las líneas. Escribe el total a mano.";
  }catch(e){
    const m={auth:"La clave de API no es válida. Revísala en Ajustes.",model:"El modelo indicado en Ajustes no existe. Cámbialo allí.",limit:"Se ha alcanzado el límite de uso de la clave de API. Prueba más tarde.",bad:"El servicio ha rechazado la petición. Revisa la clave y el modelo en Ajustes.",net:"No se pudo contactar con el servicio. Comprueba la conexión.",parse:"No he podido entender la respuesta. Inténtalo otra vez."};
    msg.textContent=(m[e?.code]||"No se pudo leer el ticket.")+" También puedes escribir el total a mano.";console.warn(e);
  }finally{btn.disabled=false;}
}