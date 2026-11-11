import postgres from "postgres";
import { makeLiveWorld } from "./live";
(async function pocketworldApp() {
  const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL, { max: 5, idle_timeout: 20 }) : null;
  const live = makeLiveWorld(sql);
  const catalogue = [
    {id:"moon-fox",name:"Moon Fox",type:"Companion",price:90,icon:"🦊",tone:"peach",description:"A clever little companion for your world."},
    {id:"cloud-cat",name:"Cloud Cat",type:"Companion",price:120,icon:"🐱",tone:"lavender",description:"A soft-hearted cloud-dwelling friend."},
    {id:"tiny-dragon",name:"Tiny Dragon",type:"Companion",price:160,icon:"🐲",tone:"mint",description:"Small wings. Big adventures."},
    {id:"starlight-room",name:"Starlight Room",type:"Room",price:110,icon:"🏰",tone:"blue",description:"Your own place above the clouds."},
    {id:"peach-garden",name:"Peach Garden",type:"World",price:95,icon:"🌸",tone:"peach",description:"A world that always feels like spring."},
    {id:"cosmic-garden",name:"Cosmic Garden",type:"World",price:145,icon:"🪐",tone:"lavender",description:"A pocket-sized universe to explore."},
    {id:"sunbeam-sticker",name:"Sunbeam Sticker",type:"Sticker",price:35,icon:"☀️",tone:"yellow",description:"Keep a little sunshine close."},
    {id:"starry-sticker",name:"Starry Sticker",type:"Sticker",price:45,icon:"✨",tone:"blue",description:"Shimmer across your collection."},
    {id:"little-trophy",name:"Little Trophy",type:"Collectible",price:75,icon:"🏆",tone:"yellow",description:"Celebrate a tiny big victory."},
    {id:"forever-heart",name:"Forever Heart",type:"Collectible",price:55,icon:"💗",tone:"pink",description:"A little reminder that someone cares."}
  ];
  let initializePromise = null;
  async function initialize() {
    if (!sql) throw new Error("storage_unconfigured");
    if (!initializePromise) initializePromise = (async () => {
      await sql.unsafe("CREATE TABLE IF NOT EXISTS pw_users (id UUID PRIMARY KEY, display_name TEXT NOT NULL, session_hash TEXT UNIQUE NOT NULL, coins INTEGER NOT NULL DEFAULT 180 CHECK (coins>=0), xp INTEGER NOT NULL DEFAULT 0 CHECK (xp>=0), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await sql.unsafe("CREATE TABLE IF NOT EXISTS pw_inventory (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES pw_users(id), item_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await sql.unsafe("ALTER TABLE pw_users ADD COLUMN IF NOT EXISTS recovery_hash TEXT");
      await sql.unsafe("ALTER TABLE pw_users ADD COLUMN IF NOT EXISTS equipped_companion TEXT");
      await sql.unsafe("ALTER TABLE pw_users ADD COLUMN IF NOT EXISTS equipped_room TEXT");
      await sql.unsafe("ALTER TABLE pw_users ADD COLUMN IF NOT EXISTS equipped_world TEXT");
      await sql.unsafe("CREATE UNIQUE INDEX IF NOT EXISTS pw_users_recovery_idx ON pw_users(recovery_hash) WHERE recovery_hash IS NOT NULL");
      await sql.unsafe("CREATE INDEX IF NOT EXISTS pw_inventory_user_idx ON pw_inventory(user_id)");
      await sql.unsafe("CREATE TABLE IF NOT EXISTS pw_challenges (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES pw_users(id), sequence TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, used BOOLEAN NOT NULL DEFAULT FALSE)");
      await sql.unsafe("CREATE TABLE IF NOT EXISTS pw_plays (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES pw_users(id), challenge_id UUID UNIQUE NOT NULL, correct BOOLEAN NOT NULL, coins_earned INTEGER NOT NULL, played_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await sql.unsafe("CREATE INDEX IF NOT EXISTS pw_plays_user_idx ON pw_plays(user_id, played_at)");
      await sql.unsafe("CREATE TABLE IF NOT EXISTS pw_gifts (code TEXT PRIMARY KEY, giver_id UUID NOT NULL REFERENCES pw_users(id), item_id TEXT NOT NULL, receiver_id UUID REFERENCES pw_users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), claimed_at TIMESTAMPTZ)");
      await sql.unsafe("CREATE TABLE IF NOT EXISTS pw_market_listings (id UUID PRIMARY KEY, seller_id UUID NOT NULL REFERENCES pw_users(id), buyer_id UUID REFERENCES pw_users(id), item_id TEXT NOT NULL, price_coins INTEGER NOT NULL CHECK(price_coins>=10 AND price_coins<=600), state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','sold','cancelled')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sold_at TIMESTAMPTZ)");
      await sql.unsafe("CREATE INDEX IF NOT EXISTS pw_market_state_idx ON pw_market_listings(state,created_at DESC)");
      await sql.unsafe("CREATE TABLE IF NOT EXISTS pw_cards (id UUID PRIMARY KEY, owner_id UUID NOT NULL REFERENCES pw_users(id), recipient TEXT NOT NULL, message TEXT NOT NULL, theme TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await sql.unsafe("CREATE TABLE IF NOT EXISTS pw_capsules (id UUID PRIMARY KEY, owner_id UUID NOT NULL REFERENCES pw_users(id), title TEXT NOT NULL, message TEXT NOT NULL, unlock_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await live.init();
    })().catch(err => { initializePromise = null; throw err; });
    await initializePromise;
  }
  function response(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {status, headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff",...headers}});
  }
  function error(message, code = 400) { return response({ok:false,error:message},code); }
  async function input(req) {
    const len = Number(req.headers.get("content-length") || 0);
    if (len > 4096) throw new Error("Request too large");
    return await req.json();
  }
  async function digest(token) {
    const hash = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
    return Array.from(new Uint8Array(hash)).map(n => n.toString(16).padStart(2,"0")).join("");
  }
  async function auth(req) {
    const cookie = (req.headers.get("cookie") || "").split(";").map(s=>s.trim()).find(s=>s.startsWith("pw_session="));
    if (!cookie) return null;
    const token = decodeURIComponent(cookie.slice("pw_session=".length));
    if (token.length > 120 || token.length < 30) return null;
    const rows = await sql.unsafe("SELECT id,display_name,coins,xp,equipped_companion,equipped_room,equipped_world,created_at FROM pw_users WHERE session_hash=$1", [await digest(token)]);
    return rows[0] || null;
  }
  async function snapshot(req) {
    const user = await auth(req);
    const market=await sql.unsafe("SELECT m.id,m.item_id,m.price_coins,m.seller_id,u.display_name AS seller_name,m.created_at FROM pw_market_listings m JOIN pw_users u ON u.id=m.seller_id WHERE m.state='active' AND ($1::boolean OR u.display_name NOT LIKE 'E2E-%') ORDER BY m.created_at DESC LIMIT 60",[Boolean(user?.display_name?.startsWith("E2E-"))]);
    if (!user) return {ok:true,user:null,catalogue,market,inventory:[],gifts:[],cards:[],capsules:[],myListings:[],stats:await stats(),live:await live.read(null)};
    const inventory = await sql.unsafe("SELECT id,item_id,created_at FROM pw_inventory WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200", [user.id]);
    const gifts = await sql.unsafe("SELECT code,item_id,claimed_at,created_at FROM pw_gifts WHERE giver_id=$1 ORDER BY created_at DESC LIMIT 30", [user.id]);
    const cards = await sql.unsafe("SELECT id,recipient,message,theme,created_at FROM pw_cards WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 30", [user.id]);
    const capsules = await sql.unsafe("SELECT id,title,unlock_at,created_at,CASE WHEN unlock_at<=NOW() THEN message ELSE NULL END AS message FROM pw_capsules WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 30", [user.id]);
    const myListings=await sql.unsafe("SELECT id,item_id,price_coins,state,created_at FROM pw_market_listings WHERE seller_id=$1 ORDER BY created_at DESC LIMIT 20",[user.id]);
    return {ok:true,user,inventory,gifts,cards,capsules,catalogue,market,myListings,stats:await stats(),live:await live.read(user.id,user.display_name.startsWith("E2E-"))};
  }
  async function stats(){
    const rows = await sql.unsafe("SELECT (SELECT count(*)::integer FROM pw_users WHERE display_name NOT LIKE 'E2E-%') AS members,(SELECT count(*)::integer FROM pw_cards c JOIN pw_users u ON u.id=c.owner_id WHERE u.display_name NOT LIKE 'E2E-%') AS cards,(SELECT count(*)::integer FROM pw_gifts g JOIN pw_users u ON u.id=g.giver_id WHERE g.claimed_at IS NOT NULL AND u.display_name NOT LIKE 'E2E-%') AS gifts");
    return rows[0] || {members:0,cards:0,gifts:0};
  }
  async function routes(req) {
    const url = new URL(req.url), path = url.pathname;
    if(req.method === "POST" && req.headers.get("origin") && req.headers.get("origin") !== (process.env.PUBLIC_ORIGIN || "https://pocketworld-github-web-production.up.railway.app"))return error("Cross-origin request rejected.",403);
    if (path === "/health") {
      try { await initialize(); await sql.unsafe("SELECT 1"); return response({ok:true,service:"pocketworld",storage:"postgres"}); }
      catch {return error("Storage temporarily unavailable",503);}
    }
    if (req.method === "GET" && path === "/api/card") {
      await initialize();
      const id = url.searchParams.get("id") || "";
      if (!/^[0-9a-f-]{36}$/.test(id)) return error("Card not found",404);
      const rows = await sql.unsafe("SELECT recipient,message,theme,created_at FROM pw_cards WHERE id=$1",[id]);
      return rows.length ? response({ok:true,card:rows[0]}) : error("Card not found",404);
    }
    if (path.startsWith("/api/")) {
      await initialize();
      if (req.method === "GET" && path === "/api/bootstrap") return response(await snapshot(req));
      if (req.method === "GET" && path === "/api/live") { const viewer=await auth(req); return response(await live.read(viewer?.id||null,Boolean(viewer?.display_name?.startsWith("E2E-")))); }
      if (req.method !== "POST") return error("Method not allowed",405);
      const data = await input(req);
      if (path === "/api/guest") {
        const name = String(data.name||"").trim().slice(0,36);
        if (name.length < 2 || /[<>]/.test(name)) return error("Choose a name (2–36 characters).");
        const existing = await auth(req);
        if (existing) return response({ok:true,already:true});
        const id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID();
        await sql.unsafe("INSERT INTO pw_users(id,display_name,session_hash) VALUES($1,$2,$3)",[id,name,await digest(token)]);
        await live.publish({actorId:id,actorType:"member",actorName:name,kind:"welcome",detail:"A new explorer started their little world."}).catch(e=>console.warn("activity_publish",e.message));
        return response({ok:true,user_id:id},200,{"Set-Cookie":"pw_session="+token+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000"});
      }
      if (path === "/api/recover") {
        const code=String(data.code||"").trim().toLowerCase();
        if(!/^[a-f0-9]{64}$/.test(code)) return error("Invalid recovery code.");
        const token=crypto.randomUUID()+crypto.randomUUID();
        const rows=await sql.unsafe("UPDATE pw_users SET session_hash=$1,recovery_hash=NULL WHERE recovery_hash=$2 RETURNING id",[await digest(token),await digest(code)]);
        if(!rows.length)return error("Recovery code is incorrect or already used.",409);
        return response({ok:true},200,{"Set-Cookie":"pw_session="+token+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000"});
      }
      const user=await auth(req);
      if(!user) return error("Create your world to continue.",401);
      if(path==="/api/daily/claim") {
        const result=await live.claim(user.id);
        if(result.ok)await live.publish({actorId:user.id,actorType:"member",actorName:user.display_name,kind:"quest",detail:"An explorer collected their daily surprise."}).catch(e=>console.warn("activity_publish",e.message));
        return response(result,result.ok?200:409);
      }
      if(path==="/api/market/visit")return response(await live.visit(user.id));
      if(path==="/api/kindness"){
        const result=await live.sendKindness(user.id,user.display_name,String(data.phrase||""));
        return response(result,result.ok?200:409);
      }
      if(path==="/api/recovery") {
        const code=(crypto.randomUUID()+crypto.randomUUID()).replaceAll("-","");
        await sql.unsafe("UPDATE pw_users SET recovery_hash=$1 WHERE id=$2",[await digest(code),user.id]);
        return response({ok:true,code});
      }
      if(path==="/api/equip"){
        const id=String(data.inventoryId||"");
        if(!/^[0-9a-f-]{36}$/.test(id))return error("Choose a collectible you own.");
        const rows=await sql.unsafe("SELECT item_id FROM pw_inventory WHERE id=$1 AND user_id=$2",[id,user.id]);
        if(!rows.length)return error("Item no longer in your collection.",409);
        const item=catalogue.find(x=>x.id===rows[0].item_id);
        if(!item||!["Companion","Room","World"].includes(item.type))return error("Only a companion, room or world can be equipped.");
        const column=item.type==="Companion"?"equipped_companion":item.type==="Room"?"equipped_room":"equipped_world";
        await sql.unsafe("UPDATE pw_users SET "+column+"=$1 WHERE id=$2",[item.id,user.id]);
        return response({ok:true,slot:item.type,item:item.id});
      }
      if(path==="/api/challenge") {
        const id=crypto.randomUUID();
        const sequence=Array.from({length:5},()=>String(Math.floor(Math.random()*4))).join("");
        await sql.unsafe("INSERT INTO pw_challenges(id,user_id,sequence,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '4 minutes')",[id,user.id,sequence]);
        return response({ok:true,id,sequence});
      }
      if(path==="/api/play") {
        const id=String(data.id||""), answer=String(data.answer||"");
        if (!/^[0-9a-f-]{36}$/.test(id)||!/^[0-3]{5}$/.test(answer)) return error("Invalid play.");
        const result=await sql.begin(async tx=>{
          const rows=await tx.unsafe("UPDATE pw_challenges SET used=TRUE WHERE id=$1 AND user_id=$2 AND used=FALSE AND expires_at>NOW() RETURNING sequence",[id,user.id]);
          if(!rows.length) return {ok:false,error:"Challenge expired or already used."};
          const correct=rows[0].sequence===answer;
          const today=await tx.unsafe("SELECT count(*)::int AS n FROM pw_plays WHERE user_id=$1 AND coins_earned>0 AND played_at>=date_trunc('day',NOW())",[user.id]);
          const coins=correct && today[0].n < 10 ? 20 : 0;
          await tx.unsafe("INSERT INTO pw_plays(id,user_id,challenge_id,correct,coins_earned) VALUES($1,$2,$3,$4,$5)",[crypto.randomUUID(),user.id,id,correct,coins]);
          if(coins) await tx.unsafe("UPDATE pw_users SET coins=coins+$1,xp=xp+25 WHERE id=$2",[coins,user.id]);
          return {ok:true,correct,coins,xp:coins?25:0,limitReached:correct&&coins===0};
        });
        return response(result,result.ok?200:409);
      }
      if(path==="/api/buy") {
        const item=catalogue.find(x=>x.id===data.item);
        if(!item)return error("Unknown item.");
        const result=await sql.begin(async tx=>{
          const wallets=await tx.unsafe("UPDATE pw_users SET coins=coins-$1 WHERE id=$2 AND coins >= $1 RETURNING coins",[item.price,user.id]);
          if(!wallets.length)return {ok:false,error:"Not enough play coins. Earn more in Memory Lab."};
          const iid=crypto.randomUUID();
          await tx.unsafe("INSERT INTO pw_inventory(id,user_id,item_id) VALUES($1,$2,$3)",[iid,user.id,item.id]);
          return {ok:true,item_id:iid,coins:wallets[0].coins};
        });
        if(result.ok)await live.publish({actorId:user.id,actorType:"member",actorName:user.display_name,kind:"collect",detail:"An explorer collected "+item.name+".",itemId:item.id}).catch(e=>console.warn("activity_publish",e.message));
        return response(result,result.ok?200:409);
      }

      if(path==="/api/market/list") {
        const id=String(data.inventoryId||""),price=Number(data.price);
        if(!/^[0-9a-f-]{36}$/.test(id)||!Number.isInteger(price)||price<10||price>600)return error("Invalid item or price. Use 10–600 Play Coins.");
        const result=await sql.begin(async tx=>{
          const owned=await tx.unsafe("DELETE FROM pw_inventory WHERE id=$1 AND user_id=$2 RETURNING item_id",[id,user.id]);
          if(!owned.length)return {ok:false,error:"Item is not in your collection."};
          const lid=crypto.randomUUID();
          await tx.unsafe("INSERT INTO pw_market_listings(id,seller_id,item_id,price_coins) VALUES($1,$2,$3,$4)",[lid,user.id,owned[0].item_id,price]);
          return {ok:true,id:lid,price,item:owned[0].item_id};
        });
        if(result.ok)await live.publish({actorId:user.id,actorType:"member",actorName:user.display_name,kind:"market",detail:"A community collectible was listed for exchange.",itemId:result.item}).catch(e=>console.warn("activity_publish",e.message));
        return response(result,result.ok?200:409);
      }
      if(path==="/api/market/buy") {
        const id=String(data.id||"");
        if(!/^[0-9a-f-]{36}$/.test(id))return error("Invalid listing.");
        const result=await sql.begin(async tx=>{
          const found=await tx.unsafe("SELECT id,item_id,price_coins,seller_id FROM pw_market_listings WHERE id=$1 AND state='active' FOR UPDATE",[id]);
          if(!found.length)return {ok:false,error:"Listing unavailable."};
          const listing=found[0];
          if(listing.seller_id===user.id)return {ok:false,error:"Cannot buy your own listing."};
          const debit=await tx.unsafe("UPDATE pw_users SET coins=coins-$1 WHERE id=$2 AND coins >= $1 RETURNING coins",[listing.price_coins,user.id]);
          if(!debit.length)return {ok:false,error:"Not enough Play Coins."};
          const fee=Math.ceil(listing.price_coins*0.05),proceeds=listing.price_coins-fee;
          await tx.unsafe("UPDATE pw_users SET coins=coins+$1 WHERE id=$2",[proceeds,listing.seller_id]);
          await tx.unsafe("UPDATE pw_market_listings SET state='sold',buyer_id=$1,sold_at=NOW() WHERE id=$2",[user.id,id]);
          await tx.unsafe("INSERT INTO pw_inventory(id,user_id,item_id) VALUES($1,$2,$3)",[crypto.randomUUID(),user.id,listing.item_id]);
          return {ok:true,item:listing.item_id,coins:debit[0].coins,fee,proceeds};
        });
        if(result.ok)await live.publish({actorId:user.id,actorType:"member",actorName:user.display_name,kind:"trade",detail:"Two explorers completed a collectible trade.",itemId:result.item}).catch(e=>console.warn("activity_publish",e.message));
        return response(result,result.ok?200:409);
      }
      if(path==="/api/market/cancel") {
        const id=String(data.id||"");
        if(!/^[0-9a-f-]{36}$/.test(id))return error("Invalid listing.");
        const result=await sql.begin(async tx=>{
          const found=await tx.unsafe("UPDATE pw_market_listings SET state='cancelled' WHERE id=$1 AND seller_id=$2 AND state='active' RETURNING item_id",[id,user.id]);
          if(!found.length)return {ok:false,error:"Only your active listing can be cancelled."};
          await tx.unsafe("INSERT INTO pw_inventory(id,user_id,item_id) VALUES($1,$2,$3)",[crypto.randomUUID(),user.id,found[0].item_id]);
          return {ok:true,item:found[0].item_id};
        });
        return response(result,result.ok?200:409);
      }
      if(path==="/api/gift") {
        const id=String(data.inventoryId||"");
        if(!/^[0-9a-f-]{36}$/.test(id))return error("Invalid item.");
        const code=crypto.randomUUID().replaceAll("-","").slice(0,20).toUpperCase();
        const result=await sql.begin(async tx=>{
          const rows=await tx.unsafe("DELETE FROM pw_inventory WHERE id=$1 AND user_id=$2 RETURNING item_id",[id,user.id]);
          if(!rows.length)return {ok:false,error:"Item no longer available."};
          await tx.unsafe("INSERT INTO pw_gifts(code,giver_id,item_id) VALUES($1,$2,$3)",[code,user.id,rows[0].item_id]);
          return {ok:true,code,item:rows[0].item_id};
        });
        if(result.ok)await live.publish({actorId:user.id,actorType:"member",actorName:user.display_name,kind:"gift",detail:"A little collectible gift was wrapped for a friend.",itemId:result.item}).catch(e=>console.warn("activity_publish",e.message));
        return response(result,result.ok?200:409);
      }
      if(path==="/api/redeem") {
        const code=String(data.code||"").trim().toUpperCase();
        if(!/^[A-F0-9]{20}$/.test(code))return error("Invalid gift code.");
        const result=await sql.begin(async tx=>{
          const rows=await tx.unsafe("UPDATE pw_gifts SET receiver_id=$1,claimed_at=NOW() WHERE code=$2 AND receiver_id IS NULL AND giver_id<>$1 RETURNING item_id",[user.id,code]);
          if(!rows.length)return {ok:false,error:"This gift is unavailable, claimed, or your own."};
          await tx.unsafe("INSERT INTO pw_inventory(id,user_id,item_id) VALUES($1,$2,$3)",[crypto.randomUUID(),user.id,rows[0].item_id]);
          return {ok:true,item:rows[0].item_id};
        });
        if(result.ok)await live.publish({actorId:user.id,actorType:"member",actorName:user.display_name,kind:"gift",detail:"A little gift found a new home.",itemId:result.item}).catch(e=>console.warn("activity_publish",e.message));
        return response(result,result.ok?200:409);
      }
      if(path==="/api/card/create") {
        const recipient=String(data.recipient||"").trim().slice(0,40);
        const message=String(data.message||"").trim().slice(0,280);
        const theme=["dream","love","birthday"].includes(data.theme)?data.theme:"dream";
        if(recipient.length<2||message.length<3)return error("Add a recipient and a personal message.");
        const id=crypto.randomUUID();
        await sql.unsafe("INSERT INTO pw_cards(id,owner_id,recipient,message,theme) VALUES($1,$2,$3,$4,$5)",[id,user.id,recipient,message,theme]);
        await live.publish({actorId:user.id,actorType:"member",actorName:user.display_name,kind:"card",detail:"An explorer made a greeting card."}).catch(e=>console.warn("activity_publish",e.message));
        return response({ok:true,id});
      }
      if(path==="/api/capsule/create") {
        const title=String(data.title||"").trim().slice(0,70);
        const message=String(data.message||"").trim().slice(0,500);
        const date=new Date(data.date||"");
        if(title.length<2||message.length<3||isNaN(date.getTime())||date.getTime()<Date.now()+60000||date.getTime()>Date.now()+5*365*86400000) return error("Choose a future date and a message.");
        const id=crypto.randomUUID();
        await sql.unsafe("INSERT INTO pw_capsules(id,owner_id,title,message,unlock_at) VALUES($1,$2,$3,$4,$5)",[id,user.id,title,message,date.toISOString()]);
        await live.publish({actorId:user.id,actorType:"member",actorName:user.display_name,kind:"capsule",detail:"An explorer sealed a memory for the future."}).catch(e=>console.warn("activity_publish",e.message));
        return response({ok:true,id});
      }
      return error("Unknown endpoint",404);
    }
    if(req.method==="GET" && (path==="/privacy" || path==="/terms")) {
      const privacy=path==="/privacy";
      const title=privacy?"Privacy notice":"Terms of use";
      const body=privacy
       ? "<p>Mochiloom is operated by Noetfield Systems Inc. This beta collects a nickname, game progress, virtual coins, owned items, greeting cards, gift transfers and any time-capsule text you choose to enter. We use an HttpOnly browser session cookie to recognize your profile and store your account records in our PostgreSQL database hosted by Railway. We do not sell user data or request a payment card in this beta. Google Fonts may receive ordinary font requests. Shared card URLs are accessible to anyone with the link. Capsule messages are not returned by the regular account API until their unlock date. A nickname is not an anonymous guarantee: avoid including personal identifiers or sensitive material in public greeting cards.</p><p>Guest accounts have no automatic email recovery. A single-use account recovery code is available from your profile; keep it private. For data access or deletion enquiries, contact Noetfield Systems through <a href='https://noetfield.com'>noetfield.com</a>. Do not create unsupervised accounts for children; this beta is intended for adult-managed use.</p>"
       : "<p>Mochiloom is a beta digital entertainment application operated by Noetfield Systems Inc. Play Coins, XP, badges and virtual collectibles are digital gameplay features. They have no cash value, are not deposits or investments, and do not earn interest. Items can only be obtained or gifted as the available in-app functions permit. There is no real-money trading or cash withdrawal. The current beta does not process payments or ship physical goods. Do not use this service to publish unlawful, abusive, or personally identifying content about others. We may remove harmful public content or suspend abusive accounts. The service and free features can change during beta testing. All future paid transactions will be subject to separately displayed purchase terms.</p><p>Adults should manage or supervise use by children. For enquiries contact <a href='https://noetfield.com'>Noetfield Systems</a>.</p>";
      return new Response("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>"+title+" | Mochiloom</title><style>body{max-width:760px;margin:5vw auto;padding:0 22px;color:#28304d;background:#f8f8fc;font:16px/1.8 system-ui}h1{font-size:36px}a{color:#6e5ad4}article{background:white;padding:32px;border-radius:22px;box-shadow:0 10px 40px #25295412}</style><article><a href='/'>← Mochiloom</a><h1>"+title+"</h1><small>Beta • 10 November 2026</small>"+body+"</article></html>",{headers:{"Content-Type":"text/html; charset=utf-8"}});
    }
    if(req.method==="GET" && path==="/robots.txt")return new Response("User-agent: *\nAllow: /\n",{headers:{"Content-Type":"text/plain"}});
    if(req.method==="GET" && path==="/sitemap.xml")return new Response('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>'+new URL(req.url).origin+'/</loc></url></urlset>',{headers:{"Content-Type":"application/xml"}});
    return new Response(PAGE,{headers:{"Content-Type":"text/html; charset=utf-8","X-Content-Type-Options":"nosniff","Referrer-Policy":"strict-origin-when-cross-origin","X-Frame-Options":"DENY","Permissions-Policy":"camera=(),microphone=(),geolocation=()","Cache-Control":"no-cache"}});
  }

  const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="theme-color" content="#131a38"/><meta name="description" content="Mochiloom is your little universe of games, collectibles, magical moments and meaningful gifts. Create your free world today."/><meta property="og:title" content="Mochiloom — A little world of your own"/><meta property="og:type" content="website"/><meta property="og:description" content="Free mini games, original collectibles, heartfelt gifts and a little world to call your own."/><meta name="twitter:card" content="summary"/><title>Mochiloom — A little world of your own</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700;800;900&display=swap');
:root{--ink:#19213d;--muted:#77809e;--side:#121a36;--violet:#7866df;--peach:#ffaf99;--surface:#fff;--border:#e9e9f3;--bg:#f6f7fc;--shadow:0 16px 55px rgba(32,35,93,.08)}
*{box-sizing:border-box}body{margin:0;font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--ink)}button,input,select,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.45}a{color:inherit;text-decoration:none}h1,h2,h3,p{margin:0}h1,h2,h3{font-family:Outfit,sans-serif}img{max-width:100%}#app{min-height:100vh}.shell{display:flex;min-height:100vh}.sidebar{width:236px;background:var(--side);color:white;position:fixed;top:0;bottom:0;left:0;z-index:10;padding:30px 16px;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:11px;font-family:Outfit;font-weight:800;font-size:21px;letter-spacing:-.6px;padding:0 10px 36px}.brandmark{width:36px;height:36px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(135deg,#fbc2ab,#a094ff);box-shadow:0 8px 20px rgba(141,109,255,.25);font-size:19px}.side-label{color:#7783ad;font-size:10px;letter-spacing:2px;margin:5px 14px 10px;font-weight:800}.nav{display:flex;align-items:center;gap:14px;color:#97a1c3;padding:13px 15px;margin:3px 0;border:0;background:transparent;width:100%;text-align:left;border-radius:14px;font-size:14px;font-weight:700}.nav.active{background:#292e57;color:#fff}.nav:hover{background:#252d50;color:white}.nav .nicon{font-size:19px;min-width:22px}.side-bottom{margin-top:auto;padding:18px 14px;border:1px solid #323b66;border-radius:17px;background:linear-gradient(150deg,#282e57,#1a2345)}.side-bottom strong{font-family:Outfit;display:block;margin-bottom:7px}.side-bottom p{font-size:12px;color:#9ea9cf;line-height:1.6}.main{margin-left:236px;width:calc(100% - 236px);padding:33px 43px 70px;max-width:1600px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px;gap:15px}.eyebrow{font-size:11px;font-weight:800;letter-spacing:2.2px;color:#8b80b8;text-transform:uppercase}.top h2{font-size:28px;letter-spacing:-.8px;margin-top:4px}.actions{display:flex;align-items:center;gap:10px}.wallet{display:flex;align-items:center;gap:9px;background:white;border:1px solid var(--border);border-radius:14px;padding:10px 16px;box-shadow:0 5px 15px rgba(40,40,80,.03);font-weight:800;font-size:14px}.wallet small{color:#9b9daf;font-size:10px}.avatar{width:41px;height:41px;border-radius:15px;background:linear-gradient(140deg,#ffe1ce,#d9d0ff);display:grid;place-items:center;font-size:22px;border:3px solid white;box-shadow:0 6px 20px #ddd9f1}.hero{border-radius:27px;min-height:313px;background:radial-gradient(ellipse at 76% 38%,#fbc6c0 0%,transparent 42%),linear-gradient(115deg,#d7d6ff,#f1d8e9 64%,#ffe8c5);padding:43px 45px;position:relative;overflow:hidden;display:flex;align-items:center;box-shadow:var(--shadow)}.hero::before{content:"";position:absolute;right:40%;top:22px;font-size:39px;color:#fff9e9}.hero::after{content:"";position:absolute;right:9%;bottom:26px;font-size:60px;color:#fff8ec}.hero-info{max-width:490px;position:relative;z-index:1}.tag{display:inline-flex;gap:7px;align-items:center;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:1.6px;color:#6455b9;background:#fff9;border:1px solid #fff7;border-radius:30px;padding:9px 13px}.hero h1{font-size:clamp(36px,4vw,58px);line-height:1.04;letter-spacing:-2.4px;margin:16px 0 13px;color:#242547}.hero p{font-size:14px;max-width:385px;color:#60617e;line-height:1.7}.hero-art{position:absolute;right:7%;top:9%;width:36%;height:85%;display:grid;place-items:center}.orb{width:240px;height:240px;border-radius:50%;background:linear-gradient(135deg,#fff5ed,#b1a4f2 55%,#8d9ded);box-shadow:0 28px 50px #8184c344,inset -15px -15px 45px #7b75cc44,inset 12px 12px 28px #fff;display:grid;place-items:center;font-size:110px;transform:rotate(-10deg)}.float{position:absolute;display:grid;place-items:center;border-radius:20px;background:#fff9;box-shadow:0 15px 32px #9397b65c;font-size:42px;padding:11px}.float.one{left:7%;top:2%;transform:rotate(-12deg)}.float.two{right:0%;bottom:9%;transform:rotate(13deg)}.btn{border:0;border-radius:13px;padding:12px 19px;font-weight:800;font-size:13px;transition:transform .2s,filter .2s}.btn:hover{transform:translateY(-2px);filter:brightness(1.03)}.btn.dark{color:white;background:#202849}.btn.primary{background:#7968e5;color:white}.btn.white{background:#fff;color:#443d8d}.btn.outline{background:white;color:#53469f;border:1px solid #e5dff5}.btn.small{padding:9px 12px;font-size:12px}.btn:focus-visible,.nav:focus-visible{outline:3px solid #a99eff;outline-offset:2px}.hero .btn{margin-top:25px}.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:31px 0 16px}.section-head h3{font-size:21px;letter-spacing:-.5px}.sub{font-size:13px;color:var(--muted);line-height:1.6}.section-link{border:0;background:none;font-size:12px;color:#7063ce;font-weight:800}.tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:17px}.tile{background:white;border:1px solid var(--border);border-radius:21px;padding:20px;box-shadow:0 6px 25px rgba(27,32,65,.035)}.tile .visual{height:138px;border-radius:15px;display:grid;place-items:center;font-size:76px;margin-bottom:15px;position:relative;overflow:hidden}.tile .visual:after{content:"";position:absolute;right:14%;top:15%;color:#fff9;font-size:25px}.visual.peach{background:radial-gradient(circle at 60% 40%,#ffe7d9,#ffd1cc)}.visual.lavender{background:radial-gradient(circle,#e9e2ff,#c6bcf7)}.visual.blue{background:radial-gradient(circle,#e2f7ff,#c4d5fb)}.visual.mint{background:radial-gradient(circle,#e8fff4,#b7e6d9)}.visual.yellow{background:radial-gradient(circle,#fff8d8,#ffe6a5)}.visual.pink{background:radial-gradient(circle,#ffeaf3,#fac0db)}.tile .type{font-size:10px;letter-spacing:1.5px;color:#9a93b6;font-weight:800;text-transform:uppercase}.tile h3{font-size:18px;margin:5px 0}.tile p{font-size:12px;color:#8d91a7;line-height:1.55;min-height:38px}.tile-bottom{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:17px}.price{font-weight:800;color:#6f61cc;font-size:14px}.stat-row{display:grid;grid-template-columns:repeat(3,1fr);gap:17px;margin-top:17px}.stat{background:white;border-radius:20px;border:1px solid var(--border);padding:20px;display:flex;align-items:center;gap:13px}.stat .ico{height:46px;width:46px;border-radius:15px;background:#f4f0ff;display:grid;place-items:center;font-size:23px}.stat b{font:800 24px Outfit}.stat span{font-size:12px;color:var(--muted)}.panel{background:white;border-radius:24px;padding:25px;border:1px solid var(--border);box-shadow:var(--shadow)}.two{display:grid;grid-template-columns:1.2fr .8fr;gap:19px}.game-pad{display:flex;gap:15px;justify-content:center;margin:28px 0}.memory{width:78px;height:78px;border:0;border-radius:20px;box-shadow:inset 0 -7px 0 #0001;transition:transform .12s;display:grid;place-items:center;font-size:32px;color:#fff}.memory:hover{transform:scale(1.045)}.memory.c0{background:#9b91f3}.memory.c1{background:#ffab9b}.memory.c2{background:#68cdb1}.memory.c3{background:#ffcb69}.memory.dim{filter:grayscale(.8);opacity:.4}.hint{background:#f7f5ff;border:1px solid #ece6ff;border-radius:15px;padding:14px 17px;font-size:13px;color:#666393;line-height:1.6}.field{width:100%;border:1px solid #e1e2ee;background:#fafbff;border-radius:12px;padding:12px 14px;outline:none;color:#242747;margin:7px 0 15px}.field:focus{border-color:#978af0;box-shadow:0 0 0 3px #eae7ff}.label{display:block;font-size:12px;font-weight:800;color:#5e6281}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}.chip{display:inline-flex;font-size:11px;font-weight:800;background:#f1efff;color:#7565cc;padding:6px 10px;border-radius:100px}.empty{background:white;border:1px dashed #dcdbe9;border-radius:19px;padding:50px 20px;text-align:center;color:#8386a4}.empty span{display:block;font-size:48px;margin-bottom:10px}.empty strong{display:block;color:#292b49;font:700 20px Outfit;margin-bottom:7px}.toast{position:fixed;right:20px;bottom:24px;z-index:100;padding:14px 19px;background:#242a52;color:#fff;border-radius:15px;box-shadow:0 18px 40px #17224440;max-width:350px;font-size:13px}.toast.bad{background:#9e4260}.footer{margin-top:55px;font-size:11px;color:#a1a7b8;display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.banner{border-radius:20px;background:linear-gradient(110deg,#f9ecff,#eeeaff);padding:25px;margin-top:20px}.small-art{width:62px;height:62px;border-radius:18px;display:grid;place-items:center;background:#f0ebff;font-size:34px;flex-shrink:0}.row{display:flex;align-items:center;gap:13px}.grow{flex:1}.gift-row{padding:14px;border-radius:16px;border:1px solid var(--border);margin:10px 0}.pill{background:#eef9f4;color:#42957b;border-radius:30px;padding:6px 10px;font-size:11px;font-weight:800}.mobilebar{display:none}.auth-screen{min-height:100vh;display:grid;grid-template-columns:1fr 1fr;background:#f7f7fc}.auth-art{background:radial-gradient(circle at 80% 20%,#ffa8a6,transparent 40%),linear-gradient(130deg,#d0c9ff,#f8d7da);padding:60px;display:flex;flex-direction:column;justify-content:space-between}.auth-art h1{font:900 clamp(48px,6vw,86px)/1.05 Outfit;letter-spacing:-3.4px;max-width:550px}.auth-art .showpiece{font-size:180px;text-align:center;text-shadow:0 27px 40px #918bbb60}.auth-box{display:grid;place-items:center;padding:40px}.auth-content{max-width:410px;width:100%}.auth-content h2{font-size:45px;letter-spacing:-1.8px;line-height:1.07;margin:16px 0}.auth-content p{font-size:14px;line-height:1.8;color:#767c93;margin-bottom:25px}.auth-content .field{background:white;padding:15px}.auth-content .btn{width:100%;margin-top:3px;padding:15px}.micro{font-size:11px;color:#9a9cb2;line-height:1.6;margin-top:16px}.card-preview{border-radius:20px;padding:31px;min-height:210px;background:linear-gradient(145deg,#d8d0ff,#ffd9df);display:grid;place-items:center;text-align:center}.card-preview h3{font-size:28px;letter-spacing:-.5px}.card-preview p{font-size:14px;line-height:1.8;max-width:320px}.capsule{background:linear-gradient(140deg,#292e58,#4b3b80);color:#fff;border-radius:21px;padding:22px}.capsule p{color:#c7cae4;font-size:12px;line-height:1.6;margin:9px 0}.capsule small{color:#d8c7ff}.mobile-only{display:none}
.world-stage{position:relative;min-height:345px;display:grid;place-items:center;overflow:hidden;border-radius:27px;background:radial-gradient(ellipse at 70% 25%,#fee9e9,transparent 48%),linear-gradient(135deg,#c8c9fb,#c7dcff);border:1px solid #ffffff90}
.world-stage.peach{background:radial-gradient(ellipse at 60% 26%,#ffe3cf,transparent 50%),linear-gradient(130deg,#f9b9bc,#ffdcb6)}
.world-stage.lavender{background:radial-gradient(ellipse at 70% 26%,#f4c8ef,transparent 48%),linear-gradient(130deg,#b7b5f0,#e9d9fb)}
.world-stage.mint{background:radial-gradient(ellipse at 65% 26%,#f0fcde,transparent 50%),linear-gradient(135deg,#99dbca,#b5dcf7)}
.world-stage.blue{background:radial-gradient(ellipse at 65% 26%,#ebfaff,transparent 50%),linear-gradient(135deg,#9fbcf6,#d7d7fc)}
.world-stage.yellow{background:radial-gradient(ellipse at 65% 26%,#fffdd5,transparent 50%),linear-gradient(135deg,#ffd6a5,#ffeec0)}
.world-stage.pink{background:radial-gradient(ellipse at 65% 26%,#ffe0ea,transparent 50%),linear-gradient(135deg,#ffbaca,#fbdcef)}
.world-sun{position:absolute;width:95px;height:95px;border-radius:50%;background:#fff3d6;top:12%;right:16%;box-shadow:0 0 75px #fff7d8c9}
.world-land{position:absolute;width:140%;height:170px;background:linear-gradient(180deg,#8db8a9,#659b96);border-radius:50% 50% 0 0;bottom:-89px;left:-20%;box-shadow:0 -9px 40px #7698ab33}
.world-cloud{position:absolute;top:16%;left:10%;font-size:50px;opacity:.9;filter:drop-shadow(0 12px 11px #ffffff66)}
.world-cloud.right{left:auto;right:12%;top:37%;font-size:34px}
.world-companion{position:relative;z-index:2;font-size:clamp(105px,12vw,165px);filter:drop-shadow(0 24px 16px #4c6a7c57);animation:bobble 3.6s ease-in-out infinite;transform-origin:center bottom}
.world-caption{position:absolute;z-index:3;bottom:19px;left:18px;right:18px;background:#ffffffcf;backdrop-filter:blur(12px);border-radius:16px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px}
@keyframes bobble{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-13px) rotate(3deg)}}
.world-options{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:14px}
.world-option{background:#fff;border:1px solid var(--border);border-radius:17px;padding:12px;display:flex;align-items:center;gap:11px}
.world-option .thumb{font-size:34px;background:#f1efff;width:53px;height:53px;border-radius:14px;display:grid;place-items:center;flex-shrink:0}
.world-option strong{font-size:13px}.world-option small{display:block;color:#8f94ac;font-size:11px;margin-top:4px}
@media(max-width:750px){.world-options{grid-template-columns:1fr}.world-stage{min-height:330px}.world-companion{font-size:116px}}
.tile .visual svg{width:130px;height:130px;max-width:94%;filter:drop-shadow(0 13px 15px rgba(83,64,116,.14));transition:transform .34s cubic-bezier(.2,.8,.2,1)}.tile:hover .visual svg{transform:translateY(-6px) rotate(-3deg) scale(1.05)}.hero .orb svg{width:220px;height:220px}.world-companion svg{width:180px;height:180px;filter:drop-shadow(0 22px 15px rgba(43,70,83,.18))}.world-option .thumb svg{width:46px;height:46px}.auth-art .showpiece svg{width:208px;height:208px;filter:drop-shadow(0 25px 28px rgba(76,72,145,.2))}.tile{transition:transform .2s,box-shadow .2s}.tile:hover{transform:translateY(-3px);box-shadow:0 18px 36px rgba(55,44,108,.09)}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}@media(max-width:1100px){.main{padding:27px 24px 80px}.hero-art{right:2%;width:39%}.orb{width:190px;height:190px;font-size:90px}.hero-info{max-width:370px}.hero h1{font-size:43px}.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:750px){.sidebar{display:none}.main{margin-left:0;width:100%;padding:19px 15px 95px}.top{margin-bottom:17px}.top h2{font-size:23px}.hero{min-height:355px;padding:26px 23px;align-items:flex-start}.hero-info{max-width:95%}.hero h1{font-size:39px;max-width:330px}.hero p{max-width:255px}.hero-art{right:0;bottom:0;top:auto;width:40%;height:58%}.orb{width:150px;height:150px;font-size:67px}.float{font-size:24px}.tiles{grid-template-columns:repeat(2,1fr);gap:10px}.tile{padding:11px;border-radius:16px}.tile .visual{height:113px;font-size:53px}.tile h3{font-size:15px}.tile p{font-size:11px}.stat-row{gap:8px}.stat{padding:12px;border-radius:14px;gap:6px;flex-direction:column;text-align:center}.stat b{font-size:19px}.stat span{font-size:10px}.stat .ico{width:38px;height:38px;font-size:18px}.two,.grid2{grid-template-columns:1fr}.mobilebar{display:flex;position:fixed;bottom:0;left:0;right:0;background:#fff;z-index:20;box-shadow:0 -9px 30px #131a3612;border-top:1px solid #edecf4;justify-content:space-around;padding:9px 5px max(8px,env(safe-area-inset-bottom))}.mobilebar button{background:none;border:0;color:#a3a4ba;font-size:10px;font-weight:800;display:grid;place-items:center;gap:3px;min-width:52px}.mobilebar button.active{color:#7264d3}.mobilebar button span{font-size:22px}.auth-screen{grid-template-columns:1fr}.auth-art{min-height:235px;padding:23px}.auth-art h1{font-size:38px;max-width:290px}.auth-art .showpiece{position:absolute;right:24px;top:65px;font-size:110px}.auth-box{padding:30px 22px}.auth-content h2{font-size:35px}.footer{margin-top:30px}.memory{width:65px;height:65px;border-radius:15px}.game-pad{gap:10px}}

/* Mochiloom studio v1 — cozy premium product, original modular scenes */
.mochi-hero{min-height:300px;border-radius:27px;display:flex;align-items:center;padding:36px 39px;position:relative;overflow:hidden;background:radial-gradient(ellipse at 75% 40%,#ffdfdb 0,transparent 42%),linear-gradient(112deg,#dad7ff,#f7dce9 70%,#ffe8cd);box-shadow:0 18px 42px #6c5a9a12}
.mochi-hero .mochi-copy{position:relative;z-index:2;max-width:49%}
.mochi-hero h1{font-size:clamp(37px,4vw,55px);letter-spacing:-2.1px;line-height:1.03;margin:12px 0}
.mochi-hero p{font-size:13px;color:#6b6589;line-height:1.8;max-width:405px}
.mochi-hero .mochi-buttons{display:flex;gap:10px;margin-top:21px;flex-wrap:wrap}
.mochi-hero .mochi-mascot{position:absolute;right:9%;top:10%;display:grid;place-items:center;width:245px;height:245px;border-radius:50%;background:radial-gradient(circle at 35% 25%,#eee9ff,#aaa3ee 75%,#9895e1);box-shadow:0 23px 35px #8a73af38,inset 18px 15px 30px #ffffff8e}
.mochi-hero .mochi-mascot svg{height:205px;width:205px;filter:drop-shadow(0 18px 15px #645b9551)}
.mochi-star{position:absolute;right:4%;top:15%;font-size:35px;animation:mochi-pulse 4s ease-in-out infinite}
.mochi-cloud{position:absolute;right:2%;bottom:20%;font-size:34px;opacity:.82}
.mochi-snapshot{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:11px;margin:16px 0}
.mochi-metric{border:1px solid #eaeaf7;background:#fff;padding:16px 11px;border-radius:17px;display:flex;gap:10px;align-items:center;box-shadow:0 8px 23px #33396b08}
.mochi-metric .mochi-metric-icon{font-size:22px;background:#f5f0ff;border-radius:12px;min-width:43px;height:43px;display:grid;place-items:center}
.mochi-metric strong{font:800 21px Outfit;display:block;line-height:1.1}
.mochi-metric small{font-size:10px;color:#8890a8;line-height:1.25;display:block;margin-top:4px}
.mochi-online{background:#fff;border:1px solid var(--border);border-radius:21px;padding:17px 20px;margin-top:16px}
.mochi-strip{display:flex;overflow:auto;gap:17px;padding:12px 0 0;scrollbar-width:thin}
.mochi-person{display:grid;justify-items:center;gap:5px;min-width:90px}
.mochi-person .face{width:52px;height:52px;border-radius:19px;display:grid;place-items:center;background:#f3eaff;position:relative;font-size:29px}
.mochi-person .face:after{content:"";height:10px;width:10px;border-radius:50%;border:2px solid #fff;position:absolute;bottom:-3px;right:-3px;background:#57be85}
.mochi-person .face[data-tone="sun"]{background:#fff1d5}.mochi-person .face[data-tone="mint"]{background:#ddf8ea}.mochi-person .face[data-tone="rose"]{background:#ffe2ec}
.mochi-person strong{font-size:11px}.mochi-person small{font-size:10px;color:#9198af}
.mochi-layout{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(270px,.9fr);gap:17px;margin-top:16px}
.mochi-feed,.mochi-side-card{background:#fff;border:1px solid var(--border);border-radius:21px;padding:21px;box-shadow:0 7px 24px #24285708}
.mochi-feed{min-width:0}
.mochi-title-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.mochi-title-row h3{font-size:20px}.mochi-title-row .section-link{white-space:nowrap}
.mochi-filters{display:flex;gap:5px}
.mochi-filter{padding:6px 9px;border:1px solid #eae8f7;border-radius:11px;font-size:11px;font-weight:800;background:#fff;color:#9791b0}
.mochi-filter.active{background:#efecff;border-color:#cfc8ff;color:#6756bb}
.mochi-feed-list{max-height:480px;overflow:auto;scrollbar-width:thin}
.mochi-event{padding:12px 0;border-top:1px solid #f0eff7;display:flex;gap:11px;align-items:flex-start}
.mochi-event-icon{height:39px;min-width:39px;border-radius:13px;display:grid;place-items:center;background:#f0edff;font-size:19px}
.mochi-event .mochi-event-body{flex:1;min-width:0}
.mochi-event strong{font-size:12px;display:block;font-weight:800;color:#333250}
.mochi-event p{font-size:11px;color:#9295ae;line-height:1.55;margin-top:3px}
.mochi-event time{color:#a4a8be;font-size:10px;white-space:nowrap}
.mochi-kindness{margin-top:13px}
.mochi-note{display:flex;gap:10px;padding:11px 0;border-top:1px solid #efeff7}
.mochi-note-ava{height:33px;min-width:33px;border-radius:12px;display:grid;place-items:center;background:#f1eeff;font-size:17px}
.mochi-note strong{font-size:11px}.mochi-note p{font-size:11px;color:#8086a3;line-height:1.5;margin-top:3px}
.mochi-kindness-form{display:flex;gap:7px;align-items:center;margin-top:14px}
.mochi-kindness-form select{min-width:0;flex:1;background:#f7f6fc;border:1px solid #e9e7f2;border-radius:12px;color:#626482;padding:11px;font-size:11px}
.mochi-kindness-form .btn{white-space:nowrap}
.mochi-quest{display:flex;gap:10px;align-items:center;padding:10px 0;border-top:1px solid #efeff8}
.mochi-quest .quest-dot{height:24px;min-width:24px;border-radius:50%;display:grid;place-items:center;border:2px solid #d2d0e7;color:#7773bf;font-weight:800;font-size:13px}
.mochi-quest.done .quest-dot{background:#40b782;color:white;border-color:#40b782}
.mochi-quest .grow{font-size:12px;color:#3b405f;font-weight:700}.mochi-quest small{font-size:10px;color:#8c87b7}
.mochi-worlds{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:thin;padding-bottom:11px}
.mochi-world-card{flex:0 0 188px;min-width:0;border:1px solid #e9e7f4;border-radius:17px;overflow:hidden;background:#fff;scroll-snap-align:start;text-align:left}
.mochi-world-card .mochi-world-caption{padding:12px}.mochi-world-card strong{font:800 14px Outfit;display:block}
.mochi-world-card small{font-size:10px;color:#8d93ad}
.mochi-world-card button{width:100%;border:0;text-align:left;background:transparent;padding:0;cursor:pointer}
.mochi-scene{height:125px;border-radius:0;display:grid;place-items:center;position:relative;isolation:isolate;overflow:hidden}
.mochi-scene.rose{background:linear-gradient(145deg,#ffcee5,#fedfc6)}.mochi-scene.violet{background:linear-gradient(145deg,#a6b4f8,#e5d2ff)}.mochi-scene.azure{background:linear-gradient(145deg,#96cef2,#d5e6ff)}.mochi-scene.mint{background:linear-gradient(145deg,#a7e8d0,#e1e5a0)}.mochi-scene.indigo{background:linear-gradient(145deg,#7d80bf,#d0beeb)}.mochi-scene.sun{background:linear-gradient(145deg,#ffdb8a,#f8bad3)}
.mochi-scene:before{content:"";width:52px;height:52px;position:absolute;right:18px;top:13px;border-radius:50%;background:#fff5d7bb;box-shadow:0 0 30px #fff9}
.mochi-scene:after{content:"";position:absolute;bottom:-49px;width:190px;height:91px;border-radius:50%;background:linear-gradient(#70c7a6,#569d99);box-shadow:0 0 20px #86b2b957}
.mochi-scene .scene-symbol{font-size:67px;z-index:1;transform:translateY(5px);filter:drop-shadow(0 15px 7px #46586c33);transition:transform .3s}
.mochi-world-card:hover .scene-symbol{transform:translateY(-2px) scale(1.1)}
.mochi-market-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.mochi-market-card{border-radius:17px;background:#fff;border:1px solid #eae9f7;display:flex;align-items:center;gap:10px;padding:12px;min-width:0}
.mochi-market-card .mochi-item-art{height:56px;min-width:56px;border-radius:14px;display:grid;place-items:center;background:#f4ecff}
.mochi-market-card svg{width:54px;height:54px}
.mochi-market-card strong{font-size:12px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mochi-market-card small{font-size:10px;color:#8890a6;display:block;margin:4px 0}
.mochi-market-card .price{font-size:11px}
.mochi-helpers{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px}
.mochi-helper{border-radius:19px;border:1px solid #ebe8f6;background:#fff;padding:16px 15px}
.mochi-helper .helper-avatar{height:77px;display:grid;place-items:center;font-size:58px;text-shadow:0 12px 20px #7871a73d}
.mochi-helper h3{font-size:15px}.mochi-helper p{font-size:11px;color:#838aa3;line-height:1.5;margin:5px 0 13px;min-height:35px}
.mochi-helper .helper-state{font-size:10px;font-weight:800;color:#378868;background:#e9f8f0;padding:7px 9px;border-radius:50px;display:block;line-height:1.5}
.mochi-empty{padding:20px;color:#8a91a8;font-size:12px;background:#f9f8fd;border-radius:15px}
.mochi-chip{font-size:10px;color:#7767c1;background:#f0ecff;padding:7px 11px;border-radius:40px;font-weight:800}
.mochi-status{font-size:11px;color:#6c7891;display:flex;gap:7px;align-items:center}
.mochi-status:before{content:"";width:8px;height:8px;border-radius:50%;background:#39b77c;display:inline-block}
.mochi-stack{display:grid;gap:15px}
.mochi-world-hero{display:grid;grid-template-columns:1fr 1fr;gap:23px;align-items:center;margin-bottom:23px}
.mochi-world-hero .mochi-scene{height:275px;border-radius:25px}.mochi-world-hero .scene-symbol{font-size:112px}
.mochi-public{padding:27px;max-width:1120px;margin:0 auto}
.mochi-public-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.mochi-public-card{border:1px solid #eae9f8;background:#fff;border-radius:20px;padding:17px}
.mochi-public-card h3{font-size:16px;margin:8px 0 6px}
.mochi-public-card p{font-size:11px;color:#8188a1;line-height:1.5}
@keyframes mochi-pulse{0%,100%{transform:scale(1) rotate(0)}50%{transform:scale(1.12) rotate(12deg)}}
@media(max-width:1100px){.mochi-metric{padding:12px 8px}.mochi-metric .mochi-metric-icon{min-width:32px;height:32px}.mochi-metric strong{font-size:17px}.mochi-metric small{font-size:9px}.mochi-helpers{grid-template-columns:repeat(2,1fr)}.mochi-market-cards{grid-template-columns:1fr 1fr}}
@media(max-width:850px){.mochi-layout{grid-template-columns:1fr}.mochi-hero .mochi-copy{max-width:66%}.mochi-hero .mochi-mascot{right:3%;width:175px;height:175px;top:24%}.mochi-hero .mochi-mascot svg{width:155px;height:155px}.mochi-snapshot{grid-template-columns:repeat(3,1fr)}}
@media(max-width:600px){.mochi-hero{padding:26px 21px;min-height:330px;align-items:flex-start}.mochi-hero .mochi-copy{max-width:95%}.mochi-hero h1{font-size:35px;max-width:300px}.mochi-hero p{max-width:265px}.mochi-hero .mochi-mascot{top:auto;bottom:10px;right:4%;width:125px;height:125px}.mochi-hero .mochi-mascot svg{height:115px;width:115px}.mochi-hero .mochi-buttons{margin-top:19px}.mochi-snapshot{grid-template-columns:repeat(2,1fr);gap:8px}.mochi-metric{padding:12px}.mochi-metric .mochi-metric-icon{min-width:38px;height:38px}.mochi-metric strong{font-size:19px}.mochi-layout{grid-template-columns:1fr}.mochi-feed,.mochi-side-card{padding:16px}.mochi-market-cards{grid-template-columns:1fr}.mochi-helpers{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.mochi-helper{padding:13px}.mochi-world-hero{grid-template-columns:1fr}.mochi-worlds{scroll-padding:0 8px}.mochi-public-grid{grid-template-columns:1fr}.mochi-filters{gap:3px}.mochi-filter{font-size:10px;padding:6px}}

</style></head><body><div id="app"><main style="min-height:100vh;display:grid;place-items:center;padding:40px;background:linear-gradient(130deg,#f6f3ff,#ffedf0);font-family:Outfit,sans-serif"><section style="max-width:530px;text-align:center"><p style="font-size:13px;font-weight:800;letter-spacing:2px;color:#7966c9">POCKETWORLD · ORIGINAL DIGITAL PLAY</p><h1 style="font-size:clamp(44px,8vw,70px);line-height:1.07;letter-spacing:-2px">A little world.<br/>A lot of wonder.</h1><p style="font-size:16px;color:#686885;margin-top:18px">Play free games, meet magical friends, collect treasures and share thoughtful gifts.</p><p style="margin-top:25px;color:#7264c9">Create a free world in seconds.</p></section></main></div><script>
(function(){
const catNames={home:['Your universe','THE MAGIC IS ALREADY HERE'],explore:['Explore Worlds','ORIGINAL STUDIO WORLDS'],world:['My Little World','MAKE IT YOUR OWN'],play:['The Playground','PLAY • LEARN • EXPLORE'],shop:['Collectible Shop','YOUR LITTLE TREASURES'],market:['Community Market','TRADE ORIGINAL COLLECTIBLES'],collection:['My Collection','ALL THE THINGS YOU LOVE'],gifts:['Gifts & Cards','SHARE A LITTLE MAGIC'],capsules:['Time Capsules','MEMORIES FOR TOMORROW']};
const NAV=[['home','🏡','Discover'],['explore','🌸','Explore Worlds'],['world','🪄','My World'],['play','🎮','Play Arcade'],['shop','🛍️','The Shop'],['market','🤝','Marketplace'],['collection','🎒','Collection'],['gifts','🎁','Gifts & Cards'],['capsules','💌','Time Capsules']];
let S={page:'home',data:null,game:null,loading:false,previewWorld:null,feedFilter:'all'};const root=document.getElementById('app');
function esc(x){return String(x==null?'':x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");}
function toast(msg,bad){const el=document.createElement('div');el.className='toast'+(bad?' bad':'');el.textContent=msg;document.body.appendChild(el);setTimeout(()=>el.remove(),3500);}
async function call(url,body){const r=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:body?JSON.stringify(body):undefined});let j=await r.json();if(!r.ok||j.ok===false)throw new Error(j.error||'Could not complete request');return j;}
async function reload(){try{S.data=await call('/api/bootstrap');render();}catch(e){root.innerHTML='<main style="padding:50px;max-width:600px;margin:auto"><h1>Our little world is waking up</h1><p>'+esc(e.message)+'</p><button onclick="location.reload()">Try again</button></main>';}}
function go(v){S.page=v;S.game=null;if(v==='explore')S.previewWorld=null;window.scrollTo(0,0);render();if(v==='market'&&S.data?.user)call('/api/market/visit',{}).then(()=>call('/api/live')).then(l=>{if(S.data)S.data.live=l}).catch(()=>{});}
function itemFor(id){return S.data.catalogue.find(x=>x.id===id)||{id:id,name:id,icon:'✨',tone:'lavender',type:'Collectible',price:0,description:''};}
function artFor(item){
 const id=typeof item==="string"?item:item.id;
 if(!["moon-fox","cloud-cat","tiny-dragon"].includes(id))return typeof item==="string"?"✨":item.icon;
 const fox=id==="moon-fox",cat=id==="cloud-cat";
 const base=fox?"#ed9d7b":cat?"#c1b8f3":"#8dd3b3";
 const inner=fox?"#fff3ea":cat?"#f6f0ff":"#dff4e2";
 const head=fox?"<path d=\"M44 85 L36 28 L85 68 M156 85 L164 28 L115 68\" fill=\"#de826a\" stroke=\"#de826a\" stroke-width=\"6\"/>":cat?"<path d=\"M39 91 L39 24 L84 69 M161 91 L161 24 L116 69\" fill=\"#aea0ea\" stroke=\"#aea0ea\" stroke-width=\"6\"/>":"<path d=\"M45 80 L52 41 L84 67 M155 80 L148 41 L116 67\" fill=\"#efd087\"/><path d=\"M48 104 L14 67 Q18 117 55 133 M152 104 L186 67 Q182 117 145 133\" fill=\"#75bea1\"/>";
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="Mochiloom original character">'+head+'<ellipse cx="100" cy="117" rx="69" ry="69" fill="'+base+'"/><ellipse cx="100" cy="150" rx="49" ry="31" fill="'+inner+'"/><ellipse cx="50" cy="130" rx="13" ry="10" fill="#f8bdb0" opacity=".65"/><ellipse cx="150" cy="130" rx="13" ry="10" fill="#f8bdb0" opacity=".65"/><circle cx="74" cy="107" r="7.5" fill="#302f50"/><circle cx="126" cy="107" r="7.5" fill="#302f50"/><circle cx="72" cy="104" r="2.7" fill="#fff"/><circle cx="124" cy="104" r="2.7" fill="#fff"/><path d="M92 139 L108 139 L100 146Z" fill="#554261"/><path d="M89 148 Q100 157 111 148" fill="none" stroke="#554261" stroke-width="4" stroke-linecap="round"/></svg>';
}
function tile(item,action,owned){return '<article class="tile"><div class="visual '+esc(item.tone)+'">'+artFor(item)+'</div><span class="type">'+esc(item.type)+'</span><h3>'+esc(item.name)+'</h3><p>'+esc(item.description)+'</p><div class="tile-bottom" style="flex-wrap:wrap"><span class="price">'+(owned?'Owned · transferable':'🟡 '+item.price+' coins')+'</span><button class="btn small '+(owned?'outline':'primary')+'" data-action="'+(owned?'gift':'buy')+'" data-value="'+esc(action)+'">'+(owned?'Gift ↗':'Collect +')+'</button>'+(owned?'<button class="btn small outline" data-action="list" data-value="'+esc(action)+'">Sell</button>':'')+'</div></article>';}
function topbar(){let d=S.data;return '<div class="top"><div><div class="eyebrow">'+catNames[S.page][1]+'</div><h2>'+catNames[S.page][0]+'</h2></div><div class="actions"><div class="wallet">🟡 '+d.user.coins+' <small>COINS</small></div><button class="avatar" style="border:0" title="Save your recovery code" aria-label="Save your recovery code" data-action="backup">🧑‍🚀</button></div></div>';}

function ago(stamp){const n=Math.max(0,Date.now()-new Date(stamp).getTime());if(!Number.isFinite(n))return 'recently';const min=Math.floor(n/60000);if(min<1)return 'just now';if(min<60)return min+'m ago';const h=Math.floor(min/60);if(h<24)return h+'h ago';return Math.floor(h/24)+'d ago';}
function liveState(){return S.data?.live||{events:[],worlds:[],helpers:[],daily:[],stats:{members:0,cards_today:0,trades_today:0,listings:0,claims_today:0,gifts_today:0},progress:{daily:false,play:false,visit:false,card:false},notes:[],kindnessOptions:[]};}
function eventIcon(kind){return ({welcome:'🌟',quest:'🏆',gift:'🎁',collect:'🐾',trade:'🤝',market:'🛍️',card:'💌',capsule:'🕰️',kindness:'💜',world:'🏝️'})[kind]||'✨';}
function scene(w){return '<div class="mochi-scene '+esc(w.tone)+'"><span class="scene-symbol">'+esc(w.symbol)+'</span></div>';}
function mochiWorldCard(w){return '<article class="mochi-world-card"><button data-action="exploreworld" data-value="'+esc(w.id)+'" aria-label="Explore '+esc(w.name)+'">'+scene(w)+'<div class="mochi-world-caption"><strong>'+esc(w.name)+'</strong><small>Original studio world · Explore →</small></div></button></article>';}
function eventRow(event){return '<article class="mochi-event"><div class="mochi-event-icon">'+eventIcon(event.kind)+'</div><div class="mochi-event-body"><strong>'+esc(event.actor_name)+(event.actor_type==='helper'?' · Official helper':' · Explorer')+'</strong><p>'+esc(event.detail)+'</p></div><time datetime="'+esc(event.created_at)+'">'+ago(event.created_at)+'</time></article>';}
function helperAvatars(live){return '<div class="mochi-online"><div class="mochi-title-row"><h3>Our little helpers are here ✨</h3><span class="mochi-status">'+live.helpers.length+' official studio helpers</span></div><p class="sub">These are our own automated story characters — not simulated people or customers.</p><div class="mochi-strip">'+live.helpers.map(h=>'<div class="mochi-person"><div class="face" data-tone="'+esc(h.accent)+'">'+h.emoji+'</div><strong>'+esc(h.name)+'</strong><small>'+esc(h.role)+'</small></div>').join('')+'</div></div>';}
function quickActions(live){return '<div class="mochi-side-card"><div class="mochi-title-row"><h3>Kindness Wall 💬</h3><span class="mochi-chip">Community notes</span></div><div class="mochi-note"><div class="mochi-note-ava">☁️</div><div><strong>Welcome Sprite · Official helper</strong><p>Welcome to our cozy world! You can be our first little hello.</p></div></div>'+(live.notes.length?live.notes.slice(0,4).map(n=>'<div class="mochi-note"><div class="mochi-note-ava">💌</div><div><strong>Explorer · '+ago(n.created_at)+'</strong><p>'+esc(n.text)+'</p></div></div>').join(''):'<p class="sub" style="padding:12px 0">No member notes yet. Start a little tradition.</p>')+'<div class="mochi-kindness-form"><select id="mochi-kindness-choice" aria-label="Choose a kind message">'+live.kindnessOptions.map(n=>'<option value="'+esc(n.id)+'">'+esc(n.text)+'</option>').join('')+'</select><button class="btn primary small" data-action="sendkindness">Share ↗</button></div></div>';}
function dailyQuests(live){const complete=live.daily.filter(q=>Boolean(live.progress[q.id])).length;return '<div class="mochi-side-card"><div class="mochi-title-row"><h3>Today in your world</h3><span class="mochi-chip">'+complete+' / '+live.daily.length+' complete</span></div>'+live.daily.map(q=>{const done=Boolean(live.progress[q.id]);let action=q.id==='daily'?'dailyclaim':q.id==='play'?'questplay':q.id==='visit'?'questvisit':'questcard';return '<div class="mochi-quest '+(done?'done':'')+'"><div class="quest-dot">'+(done?'✓':'○')+'</div><div class="grow">'+esc(q.title)+'</div><small>'+((q.coins>0)?'+'+q.coins+' coins':"Explore")+'</small>'+(done?'':'<button class="btn outline small" data-action="'+action+'">Go</button>')+'</div>';}).join('')+'<p class="sub" style="margin-top:12px">Play Coins are free in-app game points, not cash or gift credit.</p></div>';}
function mochiMarketPreview(d){const listings=d.market.filter(l=>!l.seller_name.startsWith('E2E-')).slice(0,3);const cards=listings.length?listings.map(l=>{const item=itemFor(l.item_id);return '<div class="mochi-market-card"><div class="mochi-item-art">'+artFor(item)+'</div><div class="grow"><strong>'+esc(item.name)+'</strong><small>by '+esc(l.seller_name)+'</small><span class="price">🟡 '+l.price_coins+' coins</span></div><button class="btn primary small" data-nav="market">View</button></div>';}).join(''):d.catalogue.slice(0,3).map(item=>'<div class="mochi-market-card"><div class="mochi-item-art">'+artFor(item)+'</div><div class="grow"><strong>'+esc(item.name)+'</strong><small>Original studio collection</small><span class="price">🟡 '+item.price+' coins</span></div><button class="btn primary small" data-nav="shop">Collect</button></div>').join('');return '<div class="section-head"><h3>'+(listings.length?'From our community':'From the studio collection')+'</h3><button class="section-link" data-nav="'+(listings.length?'market':'shop')+'">'+(listings.length?'Browse community marketplace':'Browse original collectibles')+' →</button></div><div class="mochi-market-cards">'+cards+'</div>';}
function helperCards(live){return '<div class="section-head"><h3>Little helpers at work ✨</h3><span class="mochi-chip">Official studio characters · automated</span></div><div class="mochi-helpers">'+live.helpers.map(h=>{const latest=live.events.find(e=>e.actor_type==='helper'&&e.actor_name===h.name);return '<article class="mochi-helper"><div class="helper-avatar">'+h.emoji+'</div><h3>'+esc(h.name)+'</h3><p>'+esc(h.job)+'</p><span class="helper-state">'+(latest?esc(latest.detail)+' · '+ago(latest.created_at):'Ready to help')+'</span></article>';}).join('')+'</div>';}
function worlds(){const live=liveState(),world=live.worlds.find(w=>w.id===S.previewWorld);if(world)return '<div class="panel"><button class="section-link" data-action="backworlds">← All studio worlds</button><div class="mochi-world-hero" style="margin-top:18px"><div>'+scene(world)+'</div><div><span class="chip">AN ORIGINAL MOCHILOOM WORLD</span><h2 style="font-size:39px;line-height:1.1;margin:17px 0">'+esc(world.name)+'</h2><p class="sub">'+esc(world.description)+'</p><p class="sub" style="margin-top:14px">Part of the studio-created universe. Explore the artwork, collect a companion, or make your own home.</p><button class="btn primary" data-nav="world" style="margin-top:22px">Customize my world ↗</button></div></div></div>';return '<div class="banner"><span class="chip">ORIGINAL PLACES · BY OUR STUDIO</span><h2 style="font-size:30px;margin:12px 0 9px">A little universe is waiting.</h2><p class="sub">Explore six original story destinations. They are made by our studio — no imaginary member creators or fake popularity counts.</p></div><div class="section-head"><h3>World atlas</h3><span class="mochi-chip">'+live.worlds.length+' studio places</span></div><div class="mochi-worlds" style="flex-wrap:wrap">'+live.worlds.map(mochiWorldCard).join('')+'</div>';}
function home(){const d=S.data,live=liveState(),c=live.stats;const visible=(S.feedFilter&&S.feedFilter!=='all')?live.events.filter(x=>x.actor_type===S.feedFilter):live.events;return '<section class="mochi-hero"><div class="mochi-copy"><span class="tag">✨ THE LITTLE WORLD IS AWAKE</span><h1>Welcome to<br/>Mochiloom.</h1><p>Original companions, tiny worlds and thoughtful surprises. Our studio helpers are already making a little magic — your story starts whenever you are ready.</p><div class="mochi-buttons"><button class="btn dark" data-nav="play">Play a little ↗</button><button class="btn white" data-nav="world">My little world ✨</button></div></div><div class="mochi-mascot">'+artFor('moon-fox')+'</div><div class="mochi-star">✨</div><div class="mochi-cloud">☁️</div></section><div class="mochi-snapshot">'+[['👥',c.members,'Real explorers'],['💌',c.gifts_today,'Gifts delivered today'],['🤝',c.trades_today,'Trades today'],['🎁',c.claims_today,'Daily rewards claimed'],['🏝️',live.worlds.length,'Studio worlds']].map(m=>'<div class="mochi-metric"><div class="mochi-metric-icon">'+m[0]+'</div><div><strong>'+Number(m[1]||0)+'</strong><small>'+m[2]+'</small></div></div>').join('')+'</div>'+helperAvatars(live)+'<div class="mochi-layout"><section class="mochi-feed"><div class="mochi-title-row"><h3>Happening in Mochiloom ✨</h3><div class="mochi-filters">'+[['all','All'],['helper','Helpers'],['member','People']].map(v=>'<button class="mochi-filter '+((S.feedFilter||'all')===v[0]?'active':'')+'" data-action="feedfilter" data-value="'+v[0]+'">'+v[1]+'</button>').join('')+'</div></div><p class="sub" style="margin-bottom:10px">Real community actions + clearly labeled official helper updates, refreshed automatically.</p><div class="mochi-feed-list" aria-live="polite">'+(visible.length?visible.slice(0,15).map(eventRow).join(''):'<div class="mochi-empty">The story board is waking up. Our studio helpers are preparing the first updates.</div>')+'</div></section><aside class="mochi-stack">'+quickActions(live)+dailyQuests(live)+'</aside></div><div class="section-head"><h3>Explore original little worlds 🌸</h3><div class="row"><button class="section-link" data-action="carousel" data-value="left">←</button><button class="section-link" data-action="carousel" data-value="right">→</button><button class="section-link" data-nav="explore">All worlds</button></div></div><div id="mochi-worlds-carousel" class="mochi-worlds">'+live.worlds.map(mochiWorldCard).join('')+'</div>'+mochiMarketPreview(d)+helperCards(live)+'<div class="banner row"><div class="small-art">💌</div><div class="grow"><h3>Make someone smile.</h3><p class="sub">Create a personal greeting or wrap a collectible for a friend.</p></div><button class="btn primary small" data-nav="gifts">Create a gift ↗</button></div>';}
function shop(){return '<div class="banner"><span class="chip">THE ORIGINAL COLLECTION • SEASON 01</span><h2 style="font-size:29px;margin:12px 0 6px">Tiny treasures. Big imagination.</h2><p class="sub">Earn free Play Coins in our memory game. Collect original digital items, keep them, gift them or list them for other members. Coins have no cash value.</p><button class="btn outline small" style="margin-top:15px" data-nav="market">Browse Community Market ↗</button></div><div class="section-head"><h3>All collectibles</h3><span class="sub">'+S.data.catalogue.length+' original designs</span></div><div class="tiles">'+S.data.catalogue.map(i=>tile(i,i.id,false)).join('')+'</div>';}
function market(){const d=S.data;return '<div class="banner"><span class="chip">TRADE ORIGINAL ITEMS · NO CASH</span><h2 style="font-size:29px;margin:12px 0 8px">Made by us. Shared by you.</h2><p class="sub">Buy and sell transferable Mochiloom collectibles using Play Coins earned in games. Sellers receive the price less a 5% in-game Coin sink. No cash trading or withdrawals.</p><button class="btn outline small" style="margin-top:15px" data-nav="collection">List an item from my collection ↗</button></div><div class="section-head"><h3>From the community</h3><span class="chip">'+d.market.length+' LISTINGS</span></div>'+(d.market.length?'<div class="tiles">'+d.market.map(l=>{const item=itemFor(l.item_id);return '<article class="tile"><div class="visual '+esc(item.tone)+'">'+artFor(item)+'</div><span class="type">'+esc(item.type)+'</span><h3>'+esc(item.name)+'</h3><p>Listed by '+esc(l.seller_name)+'</p><div class="tile-bottom"><span class="price">🟡 '+l.price_coins+'</span><button class="btn primary small" data-action="marketbuy" data-value="'+esc(l.id)+'">Buy ↗</button></div></article>';}).join('')+'</div>':'<div class="empty"><span>🤝</span><strong>Be the first to list a treasure.</strong><p>The marketplace grows with our community.</p><button class="btn primary" style="margin-top:16px" data-nav="collection">List a collectible ↗</button></div>')+'<div class="section-head"><h3>My listings</h3></div><div class="panel">'+(d.myListings.length?d.myListings.map(l=>'<div class="gift-row row"><div class="small-art">'+itemFor(l.item_id).icon+'</div><div class="grow"><strong>'+esc(itemFor(l.item_id).name)+'</strong><p class="sub">🟡 '+l.price_coins+' · '+esc(l.state)+'</p></div>'+(l.state==='active'?'<button class="btn small outline" data-action="marketcancel" data-value="'+esc(l.id)+'">Cancel</button>':'<span class="pill">'+esc(l.state)+'</span>')+'</div>').join(''):'<p class="sub">You have no listings yet.</p>')+'</div>';}
function world(){const d=S.data,owned=d.inventory,has=id=>owned.some(i=>i.item_id===id);const pet=has(d.user.equipped_companion)?itemFor(d.user.equipped_companion):null;const room=has(d.user.equipped_room)?itemFor(d.user.equipped_room):null;const space=has(d.user.equipped_world)?itemFor(d.user.equipped_world):null;const tone=(space||room||{tone:'lavender'}).tone;const choices=owned.filter(i=>['Companion','Room','World'].includes(itemFor(i.item_id).type));return '<div class="banner"><span class="chip">YOUR PERSONAL SPACE</span><h2 style="font-size:30px;margin:12px 0 7px">A tiny universe, made by you.</h2><p class="sub">Every companion and room you collect can become part of your personal world. Choose what to display, then keep exploring.</p></div><div class="world-stage '+esc(tone)+'" style="margin-top:19px"><div class="world-sun"></div><div class="world-cloud">☁️</div><div class="world-cloud right">✨</div><div class="world-land"></div><div class="world-companion">'+(pet?artFor(pet):'🐣')+'</div><div class="world-caption"><div><strong>'+esc(pet?pet.name:'Your first little friend')+'</strong><p class="sub">'+esc(space?space.name:room?room.name:'Your starter world')+'</p></div><span class="chip">LEVEL '+Math.floor(d.user.xp/100+1)+'</span></div></div><div class="section-head"><h3>Make it yours</h3><button class="section-link" data-nav="shop">Get more treasures →</button></div>'+(choices.length?'<div class="world-options">'+choices.map(i=>{const item=itemFor(i.item_id),selected=(item.type==='Companion'&&pet?.id===item.id)||(item.type==='Room'&&room?.id===item.id)||(item.type==='World'&&space?.id===item.id);return '<div class="world-option"><div class="thumb">'+artFor(item)+'</div><div class="grow"><strong>'+esc(item.name)+'</strong><small>'+esc(item.type)+'</small></div><button class="btn small '+(selected?'outline':'primary')+'" data-action="equip" data-value="'+esc(i.id)+'" '+(selected?'disabled':'')+'>'+(selected?'Equipped ✓':'Equip')+'</button></div>';}).join('')+'</div>':'<div class="empty"><span>🪄</span><strong>Your story begins here.</strong><p>Collect a companion or room from the shop to customize your world.</p><button class="btn primary" data-nav="shop" style="margin-top:16px">Visit the shop ↗</button></div>')+'<div class="banner row"><div class="small-art">🎒</div><div class="grow"><h3>Your collection lives here.</h3><p class="sub">Gift or trade items whenever you want.</p></div><button class="btn outline small" data-nav="collection">My collection →</button></div>';}
function collection(){let inv=S.data.inventory;return '<div class="banner"><h2>Every treasure tells a story.</h2><p class="sub">Your collectibles are saved to your world. Gift an item to another member or list it for Play Coins on the Community Market.</p></div><div class="section-head"><h3>My treasures</h3><span class="chip">'+inv.length+' ITEMS</span></div>'+(inv.length?'<div class="tiles">'+inv.map(i=>tile(itemFor(i.item_id),i.id,true)).join('')+'</div>':'<div class="empty"><span>🎒</span><strong>Your collection is waiting</strong><p>Play Memory Lab to earn Coins, then visit the shop.</p><button class="btn primary" data-nav="play" style="margin-top:17px">Start playing</button></div>');}
function play(){let g=S.game;let stage=g?g.phase:'welcome';let buttons=['💜','🍑','🍃','🌞'];return '<div class="two"><div class="panel"><span class="chip">SKILL GAME · FREE TO PLAY</span><h2 style="font-size:32px;margin:14px 0">Memory Lab 🧠</h2><p class="sub">Watch the colour pattern, remember it, and repeat the sequence. A correct round awards 20 Play Coins and 25 XP (up to 10 rewarded rounds per day).</p><div class="game-pad">'+buttons.map((b,i)=>'<button class="memory c'+i+(stage==='watch'?' dim':'')+'" '+(stage==='input'?'':'disabled')+' data-action="tap" data-value="'+i+'" aria-label="Colour '+(i+1)+'">'+b+'</button>').join('')+'</div><div class="hint" style="text-align:center">'+(!g?'Ready when you are.':stage==='watch'?'Remember this pattern: <strong style="font-size:25px;letter-spacing:8px;display:block;margin-top:10px">'+g.code.split('').map(n=>buttons[Number(n)]).join('')+'</strong>':stage==='input'?'Repeat the pattern: <b>'+g.answer.length+' / 5</b> selected':esc(g.message||'Game complete'))+'</div><div style="text-align:center;margin-top:24px"><button class="btn primary" data-action="start">'+(g?'New round ↻':'Start memory game ↗')+'</button></div></div><div class="panel"><span class="chip">PLAY • LEARN • COLLECT</span><h2 style="font-size:26px;margin:13px 0">Earn it. Make it yours.</h2><p class="sub" style="margin:13px 0 24px">Free games make Mochiloom fun without needing to buy anything. Play Coins can only unlock in-world digital collectibles.</p><div class="row gift-row"><div class="small-art">🟡</div><div><strong>+20 Play Coins</strong><p class="sub">Per correct, eligible round</p></div></div><div class="row gift-row"><div class="small-art">✨</div><div><strong>+25 Experience</strong><p class="sub">Level up with your memory skills</p></div></div><div class="row gift-row"><div class="small-art">🎁</div><div><strong>Gift collectibles</strong><p class="sub">Turn treasures into shared moments</p></div></div></div></div>';}
function gifts(){const d=S.data;let giftLinks=d.gifts.map(g=>'<div class="gift-row row"><div class="small-art">'+itemFor(g.item_id).icon+'</div><div class="grow"><strong>'+esc(itemFor(g.item_id).name)+'</strong><p class="sub">'+(g.claimed_at?'Gift claimed':'Awaiting recipient')+'</p></div>'+(!g.claimed_at?'<button class="btn outline small" data-action="copygift" data-value="'+esc(g.code)+'">Copy link ↗</button>':'<span class="pill">Delivered</span>')+'</div>').join('');let cards=d.cards.map(c=>'<div class="gift-row row"><div class="small-art">💌</div><div class="grow"><strong>For '+esc(c.recipient)+'</strong><p class="sub">'+esc(c.message.slice(0,65))+'</p></div><button class="btn outline small" data-action="copycard" data-value="'+esc(c.id)+'">Copy link ↗</button></div>').join('');return '<div class="two"><div class="panel"><span class="chip">FREE DIGITAL CARD MAKER</span><h2 style="font-size:29px;margin:13px 0">Send a little magic 💌</h2><p class="sub" style="margin-bottom:20px">Create a personalized, shareable greeting card for someone special.</p><form id="card-form"><label class="label">Who is it for?</label><input class="field" name="recipient" required maxlength="40" placeholder="Someone wonderful"/><label class="label">Your message</label><textarea class="field" name="message" rows="4" maxlength="280" required placeholder="A little note from your heart..."></textarea><label class="label">Theme</label><select class="field" name="theme"><option value="dream">Dreamy lavender</option><option value="love">Sweet pink</option><option value="birthday">Birthday sunshine</option></select><button class="btn primary" type="submit">Create my card ↗</button></form></div><div class="panel"><div class="card-preview"><div><div style="font-size:45px">💖</div><h3>A little love, just for you.</h3><p>Every thoughtful note makes the world a bit brighter.</p></div></div><div class="section-head"><h3>Your cards</h3></div>'+(cards||'<p class="sub">Your beautiful cards will appear here.</p>')+'</div></div><div class="section-head"><h3>Gift something from your collection</h3></div><div class="panel"><p class="sub">Open Collection, choose an item and tap Gift. The item moves to a one-time gift code. Share the link with a friend.</p><div style="margin-top:15px"><button class="btn outline small" data-nav="collection">My collection →</button></div><div class="section-head"><h3>Sent gifts</h3></div>'+(giftLinks||'<p class="sub">No gifts sent yet.</p>')+'</div><div class="banner"><h3>Have a gift code?</h3><p class="sub" style="margin:7px 0">Claim an item someone sent to you.</p><form id="claim-form" class="row" style="align-items:center;flex-wrap:wrap"><input class="field" style="max-width:280px;margin:0" name="code" maxlength="20" required placeholder="20-character gift code"/><button class="btn dark">Redeem gift ↗</button></form></div><div class="banner row"><div class="small-art">🕰️</div><div class="grow"><h3>Save a memory for later.</h3><p class="sub">Write a private note that opens on a date you choose.</p></div><button class="btn outline small" data-nav="capsules">Time Capsules →</button></div>';}
function capsules(){const cs=S.data.capsules;return '<div class="two"><div class="panel"><span class="chip">SAVE SOMETHING MEANINGFUL</span><h2 style="font-size:30px;margin:13px 0">A message to future you 💫</h2><p class="sub" style="margin:14px 0 23px">Write a little moment, lock it away and rediscover it on a date of your choice. No money or investment returns are involved.</p><form id="capsule-form"><label class="label">Give it a name</label><input name="title" class="field" maxlength="70" placeholder="My wish for next year" required/><label class="label">Your secret message</label><textarea class="field" rows="5" name="message" maxlength="500" required placeholder="Dear future me..."></textarea><label class="label">Unlock on</label><input class="field" name="date" type="date" required min="'+new Date(Date.now()+86400000).toISOString().slice(0,10)+'"/><button type="submit" class="btn primary">Seal the capsule ✨</button></form></div><div class="panel"><div class="card-preview" style="background:linear-gradient(140deg,#e8e2ff,#ddf5ed)"><div><div style="font-size:62px">🕰️</div><h3>Some things are worth keeping.</h3><p>Your moments, safely stored until the right day.</p></div></div><div class="section-head"><h3>Your time capsules</h3></div>'+(cs.length?cs.map(c=>'<div class="capsule" style="margin:10px 0"><small>'+new Date(c.unlock_at).toLocaleDateString()+'</small><h3>'+esc(c.title)+'</h3><p>'+(c.message?esc(c.message):'🔒 Sealed until unlock date')+'</p></div>').join(''):'<p class="sub">Your first time capsule belongs here.</p>')+'</div></div>';}
function logged(){let d=S.data;const sections={home,worlds,explore:worlds,world,play,shop,market,collection,gifts,capsules};root.innerHTML='<div class="shell"><aside class="sidebar"><div class="brand"><div class="brandmark">✦</div>pocketworld<span style="color:#b4a7ff">.</span></div><div class="side-label">YOUR UNIVERSE</div>'+NAV.map(n=>'<button class="nav '+(S.page===n[0]?'active':'')+'" data-nav="'+n[0]+'"><span class="nicon">'+n[1]+'</span>'+n[2]+'</button>').join('')+'<div class="side-bottom"><strong>✨ Hi, '+esc(d.user.display_name)+'!</strong><p>Your world is yours to imagine, grow and share.</p><p style="margin-top:12px;color:#c0b8fd">'+d.user.xp+' XP earned</p><button class="btn small outline" data-action="backup" style="margin-top:12px">🔐 Account recovery</button></div></aside><main class="main">'+topbar()+(sections[S.page]||home)()+'<footer class="footer"><span>© 2026 Mochiloom by Noetfield Systems Inc.</span><span>Free-to-play • Coins have no cash value • <a href="/privacy">Privacy</a> • <a href="/terms">Terms</a></span></footer></main><div class="mobilebar">'+NAV.filter(n=>['home','world','play','shop','gifts'].includes(n[0])).map(n=>'<button class="'+(S.page===n[0]?'active':'')+'" data-nav="'+n[0]+'"><span>'+n[1]+'</span>'+n[2].replace(' Arcade','').replace('The ','')+'</button>').join('')+'</div></div>';}
function signedOut(){const live=liveState();root.innerHTML='<div class="auth-screen"><div class="auth-art"><div class="brand" style="padding:0;color:#242443"><div class="brandmark">✦</div>mochiloom<span style="color:#7963bc">.</span></div><div><div class="eyebrow" style="margin-bottom:16px">A LITTLE UNIVERSE OF WONDER</div><h1>Make a little magic, every day.</h1><p style="color:#5f5a81;font-size:15px;line-height:1.7;margin-top:17px;max-width:420px">A cozy world full of original companions, cheerful stories, tiny games and gifts that mean something.</p></div><div class="showpiece">'+artFor("moon-fox")+'</div><div class="mochi-status" style="color:#4d5577">'+live.helpers.length+' official helpers are preparing your little world</div></div><div class="auth-box"><div class="auth-content"><div class="eyebrow">YOUR MAGIC STARTS HERE</div><h2>Every world starts with a hello.</h2><p>Create your own space in seconds. Meet a companion, play an original memory game, collect tiny treasures and share thoughtful gifts. No payment card or invitation required.</p><form id="join-form"><label class="label">What should we call you?</label><input name="name" class="field" required maxlength="36" minlength="2" placeholder="Choose your explorer name"/><button class="btn primary">Create my free world ↗</button></form><div class="micro">Your account begins in this browser. Save the one-time recovery code from your profile to restore access later. Adults should supervise any use by children. <button type="button" data-action="restore" style="border:0;background:none;color:#6450c8;text-decoration:underline">Restore an existing world</button></div><div class="banner" style="margin-top:24px;padding:17px"><span class="chip">FOUNDING SEASON · FREE</span><p class="sub" style="margin-top:7px">180 welcome Play Coins · original starter companions · no cash value or withdrawal.</p></div><div class="mochi-metric" style="margin-top:15px"><div class="mochi-metric-icon">✨</div><div><strong>'+Number(live.stats.members||0)+'</strong><small>real member worlds created so far — be among the first</small></div></div></div></div></div><section class="mochi-public"><div class="mochi-title-row"><div><div class="eyebrow">THE STUDIO IS ALREADY AWAKE</div><h2 style="font-size:27px;margin-top:8px">A little magic is happening ✨</h2></div><span class="mochi-chip">First-party studio activities</span></div><p class="sub" style="margin:10px 0 18px">Mochiloom has original worlds and automated official helper characters. These are not fictitious members or simulated purchases.</p><div class="mochi-public-grid">'+live.helpers.slice(0,3).map(h=>'<div class="mochi-public-card"><div style="font-size:42px">'+h.emoji+'</div><h3>'+esc(h.name)+'</h3><p>'+esc(h.job)+'</p><span class="mochi-chip">Official helper</span></div>').join('')+'</div><div class="section-head"><h3>Original story destinations</h3><a class="section-link" href="#join-form">Make my world ↗</a></div><div class="mochi-worlds">'+live.worlds.slice(0,5).map(w=>'<article class="mochi-world-card">'+scene(w)+'<div class="mochi-world-caption"><strong>'+esc(w.name)+'</strong><small>Studio-created world</small></div></article>').join('')+'</div><div class="mochi-layout"><div class="mochi-feed"><div class="mochi-title-row"><h3>Our story board</h3><span class="mochi-chip">Live first-party updates</span></div>'+(live.events.length?live.events.slice(0,5).map(eventRow).join(''):'<p class="mochi-empty">Our helpers are writing the first chapter.</p>')+'</div><div class="mochi-side-card"><div class="mochi-title-row"><h3>Why we made Mochiloom 💜</h3></div><p class="sub">Because a little space to play, collect, build, remember and give can make an ordinary day magical. Our worlds and collectibles begin right here, with Noetfield Systems — no merchant network, third-party gift cards or speculative token needed.</p><a class="btn primary" href="#join-form" style="display:inline-block;margin-top:18px">Join the first explorers ↗</a></div></div><footer class="footer"><span>© 2026 Mochiloom · An original Noetfield Systems Inc. experience</span><span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · Beta release</span></footer></section>';}
function publicCard(c){root.innerHTML='<div style="background:#f7f5ff;min-height:100vh;display:grid;place-items:center;padding:20px"><div style="max-width:600px;width:100%"><div class="card-preview" style="min-height:340px;'+(c.theme==='love'?'background:linear-gradient(135deg,#ffc6d5,#ffe4e6)':c.theme==='birthday'?'background:linear-gradient(135deg,#fff2bd,#ffcdad)':'')+'"><div><div style="font-size:68px">💌</div><div class="eyebrow" style="margin:14px 0">A PERSONAL NOTE FOR</div><h3>'+esc(c.recipient)+'</h3><p style="margin-top:18px">'+esc(c.message)+'</p></div></div><div style="text-align:center;margin-top:23px"><strong>Made with Mochiloom ✨</strong><p class="sub" style="margin:8px 0 20px">A little magic is better when shared.</p><button class="btn primary" onclick="location.href=location.origin">Make your own card ↗</button></div></div></div>';}
function render(){if(S.data){if(!S.data.user)signedOut();else logged();}}
async function action(a,v){try{
if(a==='feedfilter'){S.feedFilter=v;render();}
if(a==='carousel'){document.getElementById('mochi-worlds-carousel')?.scrollBy({left:v==='right'?360:-360,behavior:'smooth'});}
if(a==='exploreworld'){S.previewWorld=v;S.page='explore';render();window.scrollTo(0,0);}
if(a==='backworlds'){S.previewWorld=null;render();}
if(a==='dailyclaim'){const r=await call('/api/daily/claim',{});await reload();S.page='home';render();toast('Daily surprise! +'+r.coins+' Play Coins ✨');}
if(a==='questplay'){go('play');}
if(a==='questvisit'){await call('/api/market/visit',{});await reload();go('market');}
if(a==='questcard'){go('gifts');}
if(a==='sendkindness'){const phrase=document.getElementById('mochi-kindness-choice')?.value;if(!phrase)return;await call('/api/kindness',{phrase});await reload();S.page='home';render();toast('A little kindness was shared 💜');}
if(a==='backup'){const r=await call('/api/recovery',{});try{await navigator.clipboard.writeText(r.code);}catch{}window.prompt('Your SINGLE-USE recovery code — keep it somewhere safe. It can restore this world once, then expires. A new code invalidates the previous one. Copy it now:',r.code);toast('Recovery code generated. Keep it private.');}
if(a==='restore'){const code=window.prompt('Enter your single-use Mochiloom recovery code:');if(!code)return;await call('/api/recover',{code:code.trim()});await reload();toast('Your world is back ✨');}
if(a==='equip'){const r=await call('/api/equip',{inventoryId:v});await reload();S.page='world';render();toast(r.slot+' equipped ✨');}
if(a==='list'){const p=window.prompt('Set your listing price in Play Coins (10–600):','80');if(p===null)return;const price=Number(p);if(!Number.isInteger(price)||price<10||price>600)throw new Error('Choose a whole-number price between 10 and 600.');await call('/api/market/list',{inventoryId:v,price});await reload();S.page='market';render();toast('Your collectible is listed ✨');}
if(a==='marketbuy'){if(!window.confirm('Buy this collectible with Play Coins?'))return;const r=await call('/api/market/buy',{id:v});await reload();S.page='collection';render();toast('Collected '+itemFor(r.item).name+' from the community.');}
if(a==='marketcancel'){await call('/api/market/cancel',{id:v});await reload();S.page='collection';render();toast('Listing cancelled. Your item is back in your collection.');}
if(a==='buy'){await call('/api/buy',{item:v});toast('Your new treasure has joined your collection ✨');await reload();}
if(a==='gift'){if(!confirm('Gift this collectible? It will leave your collection until your friend claims it.'))return;const r=await call('/api/gift',{inventoryId:v});await reload();await copyGift(r.code);}
if(a==='copygift')await copyGift(v);
if(a==='copycard')await copyUrl(location.origin+'/card/'+v);
if(a==='start'){const g=await call('/api/challenge',{});S.page='play';S.game={id:g.id,code:g.sequence,phase:'watch',answer:''};render();setTimeout(()=>{if(S.game&&S.game.id===g.id&&S.game.phase==='watch'){S.game.phase='input';render();}},2700);}
if(a==='tap'){if(!S.game||S.game.phase!=='input')return;S.game.answer+=v;if(S.game.answer.length===5){let g=S.game;g.phase='done';g.message='Checking your pattern...';render();const res=await call('/api/play',{id:g.id,answer:g.answer});g.message=res.correct?(res.coins?'Brilliant! +'+res.coins+' coins and +'+res.xp+' XP ✨':'Correct! Daily reward limit reached. Come back tomorrow.'): 'Almost! You can try another pattern.';await reload();S.page='play';S.game=g;render();}else render();}
}catch(e){toast(e.message,true);}}
async function copyUrl(url){try{await navigator.clipboard.writeText(url);toast('Link copied to your clipboard ✨');}catch{window.prompt('Copy this link:',url);}}
async function copyGift(code){await copyUrl(location.origin+'/gift/'+code);}
document.addEventListener('click',e=>{const n=e.target.closest('[data-nav]');if(n){go(n.dataset.nav);return;}const a=e.target.closest('[data-action]');if(a){action(a.dataset.action,a.dataset.value);}});
document.addEventListener('submit',async e=>{const f=e.target;if(!['join-form','card-form','claim-form','capsule-form'].includes(f.id))return;e.preventDefault();const d=Object.fromEntries(new FormData(f).entries());try{
if(f.id==='join-form'){await call('/api/guest',d);await reload();const gift=sessionStorage.getItem('pendingGift');if(gift){sessionStorage.removeItem('pendingGift');try{const r=await call('/api/redeem',{code:gift});await reload();S.page='collection';render();toast('Gift claimed! '+itemFor(r.item).name);}catch(err){toast(err.message,true);}}else toast('Welcome to your world ✨');}
if(f.id==='card-form'){const r=await call('/api/card/create',d);await reload();S.page='gifts';render();await copyUrl(location.origin+'/card/'+r.id);}
if(f.id==='claim-form'){const r=await call('/api/redeem',d);await reload();S.page='collection';render();toast('Gift claimed! '+itemFor(r.item).name+' is yours.');}
if(f.id==='capsule-form'){d.date=new Date(d.date+'T12:00:00').toISOString();await call('/api/capsule/create',d);await reload();S.page='capsules';render();toast('Time capsule sealed ✨');}
}catch(err){toast(err.message,true);}});
(async()=>{const path=location.pathname;if(path.startsWith('/card/')){try{const res=await call('/api/card?id='+encodeURIComponent(path.slice(6)));publicCard(res.card);}catch{root.innerHTML='<div class="empty"><strong>Card not found</strong><a href="/">Go home</a></div>';}return;}
if(path.startsWith('/gift/')){const code=path.slice(6);await reload();if(S.data&&S.data.user){S.page='gifts';render();try{const r=await call('/api/redeem',{code});toast('Gift claimed! '+itemFor(r.item).name);S.page='collection';await reload();}catch(e){toast(e.message,true);}}else{sessionStorage.setItem('pendingGift',code);}return;}
await reload();setInterval(async()=>{if(document.hidden||!S.data)return;try{const l=await call('/api/live');if(S.data){S.data.live=l;if(S.data.user&&S.page==='home')render();}}catch{}},30000);if(S.data&&S.data.user){const gift=sessionStorage.getItem('pendingGift');if(gift){sessionStorage.removeItem('pendingGift');try{await call('/api/redeem',{code:gift});await reload();S.page='collection';render();toast('Your gift is here ✨');}catch(e){toast(e.message,true);}}}
})();
})();
</script></body></html>`;
  live.pulse().catch(e=>console.warn("helper_pulse_start",e.message));
  const helperTimer=setInterval(()=>live.pulse().catch(e=>console.warn("helper_pulse",e.message)),60_000);
  helperTimer.unref?.();
  Bun.serve({
    port:Number(process.env.PORT||3000),
    async fetch(req) {
      try { return await routes(req); }
      catch (e) { console.error("pocketworld_error",e?.message||String(e));return error("Something went wrong. Please retry.",500); }
    }
  });
})();
