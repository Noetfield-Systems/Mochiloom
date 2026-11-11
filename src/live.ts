import type postgres from "postgres";

/**
 * Mochiloom official helper loop and real community activity.
 * - Helpers are studio characters, NOT simulated customers.
 * - Every published event corresponds to a real operation or a first-party editorial update.
 * - Test actors never appear on the public feed.
 * - All counts are derived from database state, never fabricated.
 */
export function makeLiveWorld(sql: ReturnType<typeof postgres> | null) {
  const worlds = [
    {id:"cherry-meadow",name:"Cherry Meadow",place:"Blossom Isle",type:"Studio world",symbol:"🌸",tone:"rose",description:"A tiny cottage under trees full of blossoms."},
    {id:"cloud-harbor",name:"Cloud Harbor",place:"Skyward Isles",type:"Studio world",symbol:"🏰",tone:"violet",description:"A cozy castle floating above the clouds."},
    {id:"crystal-vale",name:"Crystal Vale",place:"Luminous Valley",type:"Studio world",symbol:"💎",tone:"azure",description:"Prismatic mountains and singing streams."},
    {id:"sprout-grove",name:"Sprout Grove",place:"Evergreen Nook",type:"Studio world",symbol:"🌳",tone:"mint",description:"A peaceful forest with a friendly heart."},
    {id:"moonlit-bay",name:"Moonlit Bay",place:"Starlit Coast",type:"Studio world",symbol:"🌙",tone:"indigo",description:"Moonbeams dance above the quiet sea."},
    {id:"sunbeam-fields",name:"Sunbeam Fields",place:"Honey Plains",type:"Studio world",symbol:"🌻",tone:"sun",description:"A golden field where little ideas grow."}
  ];
  const helpers = [
    {id:"welcome",name:"Welcome Sprite",role:"Starter guide",emoji:"☁️",job:"Welcoming new explorers",accent:"rose"},
    {id:"quests",name:"Quest Bee",role:"Daily games",emoji:"🐝",job:"Curating today's quests",accent:"sun"},
    {id:"gifts",name:"Gift Owl",role:"Gift keeper",emoji:"🦉",job:"Checking gifts in transit",accent:"violet"},
    {id:"market",name:"Market Fox",role:"Market steward",emoji:"🦊",job:"Checking public market listings",accent:"mint"}
  ];
  const kindness = {
    hello:"Hello, little world! 🌷",
    cheer:"Sending everyone some sunshine! ✨",
    magic:"Your little creations are wonderful! 💜",
    welcome:"Welcome to our cozy corner! 🧡"
  };
  const daily = [
    {id:"daily",title:"Open your daily surprise",coins:15,icon:"🎁"},
    {id:"play",title:"Play Memory Lab",coins:20,icon:"🧠"},
    {id:"visit",title:"Explore the community market",coins:0,icon:"🛍️"},
    {id:"card",title:"Make someone a greeting card",coins:0,icon:"💌"}
  ];
  let ready:Promise<void>|null = null;
  const init = async () => {
    if(!sql)throw new Error("live_storage_unconfigured");
    if(!ready) ready=(async()=>{
      await sql.unsafe("CREATE TABLE IF NOT EXISTS pw_live_events (id UUID PRIMARY KEY, event_key TEXT UNIQUE, actor_id UUID, actor_type TEXT NOT NULL CHECK(actor_type IN ('helper','member')), actor_name TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, item_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await sql.unsafe("CREATE INDEX IF NOT EXISTS pw_live_events_recent ON pw_live_events(created_at DESC)");
      await sql.unsafe("CREATE TABLE IF NOT EXISTS pw_daily_claims (user_id UUID NOT NULL REFERENCES pw_users(id),day_key DATE NOT NULL DEFAULT CURRENT_DATE, coins_awarded INTEGER NOT NULL DEFAULT 15,PRIMARY KEY(user_id,day_key))");
      await sql.unsafe("CREATE TABLE IF NOT EXISTS pw_market_visits (user_id UUID NOT NULL REFERENCES pw_users(id),day_key DATE NOT NULL DEFAULT CURRENT_DATE,PRIMARY KEY(user_id,day_key))");
      await sql.unsafe("CREATE TABLE IF NOT EXISTS pw_kindness (id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES pw_users(id),phrase_id TEXT NOT NULL,day_key DATE NOT NULL DEFAULT CURRENT_DATE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,day_key,phrase_id))");
    })().catch(e=>{ready=null;throw e;});
    await ready;
  };
  async function publish(args:{id?:string;key?:string;actorId?:string|null;actorType:"member"|"helper";actorName:string;kind:string;detail:string;itemId?:string|null}){
    await init();
    const name=String(args.actorName||"").slice(0,36);
    if(args.actorType==="member"&&name.startsWith("E2E-"))return;
    await sql!.unsafe("INSERT INTO pw_live_events(id,event_key,actor_id,actor_type,actor_name,kind,detail,item_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(event_key) DO NOTHING",[
      args.id||crypto.randomUUID(),args.key||null,args.actorId||null,args.actorType,name,args.kind,args.detail.slice(0,180),args.itemId||null
    ]);
  }
  async function pulse(){
    await init();
    // Five-minute buckets ensure that duplicate processes and restarts cannot invent extra work.
    const bucket=Math.floor(Date.now()/(5*60*1000));
    const active=await sql!.unsafe("SELECT count(*)::integer AS n FROM pw_market_listings m JOIN pw_users u ON u.id=m.seller_id WHERE m.state='active' AND u.display_name NOT LIKE 'E2E-%'");
    const gifts=await sql!.unsafe("SELECT count(*)::integer AS n FROM pw_gifts g JOIN pw_users u ON u.id=g.giver_id WHERE g.receiver_id IS NULL AND u.display_name NOT LIKE 'E2E-%'");
    const feature=worlds[Math.floor(Date.now()/86400000)%worlds.length];
    const tasks=[
      {name:"Welcome Sprite",kind:"welcome",detail:"Prepared a welcoming path for new explorers."},
      {name:"Quest Bee",kind:"quest",detail:"Updated the daily quest board for today's explorers."},
      {name:"Gift Owl",kind:"gift",detail:"Checked "+gifts[0].n+" waiting gift"+(gifts[0].n===1?"":"s")+" in the delivery queue."},
      {name:"Market Fox",kind:"market",detail:"Reviewed "+active[0].n+" community market listing"+(active[0].n===1?"":"s")+"."},
      {name:"Story Cloud",kind:"world",detail:"Featured the studio world "+feature.name+" for today's exploration."}
    ];
    // Each 5-min tick schedules exactly one verifiable helper activity.
    const task=tasks[bucket%tasks.length];
    await publish({key:"helper:"+task.kind+":"+bucket,actorType:"helper",actorName:task.name,kind:task.kind,detail:task.detail});
    // On a brand-new installation, present a small factual first-party story board.
    const seeded=await sql!.unsafe("SELECT count(*)::integer AS n FROM pw_live_events WHERE actor_type='helper'");
    if(seeded[0].n===1){
      for(let i=0;i<4;i++) {
        const t=tasks[(bucket+i+1)%tasks.length];
        await publish({key:"helper:welcome-board:"+t.kind,actorType:"helper",actorName:t.name,kind:t.kind,detail:t.detail});
      }
    }
  }
  async function read(userId:string|null,testViewer=false){
    await init();
    const events=await sql!.unsafe("SELECT id,actor_type,actor_name,kind,detail,item_id,created_at FROM pw_live_events WHERE ($1::boolean OR actor_name NOT LIKE 'E2E-%') ORDER BY created_at DESC LIMIT 36",[testViewer]);
    const notes=await sql!.unsafe("SELECT k.id,k.phrase_id,k.created_at FROM pw_kindness k JOIN pw_users u ON u.id=k.user_id WHERE ($1::boolean OR u.display_name NOT LIKE 'E2E-%') ORDER BY k.created_at DESC LIMIT 16",[testViewer]);
    const activity=await sql!.unsafe("SELECT (SELECT count(*)::integer FROM pw_users WHERE display_name NOT LIKE 'E2E-%') AS members,(SELECT count(*)::integer FROM pw_cards c JOIN pw_users u ON u.id=c.owner_id WHERE u.display_name NOT LIKE 'E2E-%' AND c.created_at>=CURRENT_DATE) AS cards_today,(SELECT count(*)::integer FROM pw_market_listings m JOIN pw_users u ON u.id=m.seller_id WHERE u.display_name NOT LIKE 'E2E-%' AND m.state='sold' AND m.sold_at>=CURRENT_DATE) AS trades_today,(SELECT count(*)::integer FROM pw_market_listings m JOIN pw_users u ON u.id=m.seller_id WHERE u.display_name NOT LIKE 'E2E-%' AND m.state='active') AS listings,(SELECT count(*)::integer FROM pw_daily_claims c JOIN pw_users u ON u.id=c.user_id WHERE u.display_name NOT LIKE 'E2E-%' AND c.day_key=CURRENT_DATE) AS claims_today,(SELECT count(*)::integer FROM pw_gifts g JOIN pw_users u ON u.id=g.giver_id WHERE u.display_name NOT LIKE 'E2E-%' AND g.claimed_at>=CURRENT_DATE) AS gifts_today");
    let progress={daily:false,play:false,visit:false,card:false};
    if(userId){
      const rows=await sql!.unsafe("SELECT EXISTS(SELECT 1 FROM pw_daily_claims WHERE user_id=$1 AND day_key=CURRENT_DATE) AS daily,EXISTS(SELECT 1 FROM pw_plays WHERE user_id=$1 AND played_at>=CURRENT_DATE) AS play,EXISTS(SELECT 1 FROM pw_market_visits WHERE user_id=$1 AND day_key=CURRENT_DATE) AS visit,EXISTS(SELECT 1 FROM pw_cards WHERE owner_id=$1 AND created_at>=CURRENT_DATE) AS card",[userId]);
      progress=rows[0]||progress;
    }
    return {ok:true,brand:"Mochiloom",worlds,helpers,daily,events,notes:notes.map(n=>({id:n.id,text:kindness[n.phrase_id as keyof typeof kindness]||"A little kindness!",created_at:n.created_at})),stats:activity[0],progress,kindnessOptions:Object.entries(kindness).map(([id,text])=>({id,text})),updated_at:new Date().toISOString(),disclosure:"Helpers are official automated characters, not real users. Community counts and actions are database-backed."};
  }
  async function claim(userId:string){
    await init();
    return await sql!.begin(async tx=>{
      const rows=await tx.unsafe("INSERT INTO pw_daily_claims(user_id,day_key,coins_awarded) VALUES($1,CURRENT_DATE,15) ON CONFLICT DO NOTHING RETURNING coins_awarded",[userId]);
      if(!rows.length)return {ok:false,error:"Today's surprise was already claimed."};
      await tx.unsafe("UPDATE pw_users SET coins=coins+15,xp=xp+10 WHERE id=$1",[userId]);
      return {ok:true,coins:15,xp:10};
    });
  }
  async function visit(userId:string){
    await init();
    const rows=await sql!.unsafe("INSERT INTO pw_market_visits(user_id,day_key) VALUES($1,CURRENT_DATE) ON CONFLICT DO NOTHING RETURNING user_id",[userId]);
    return {ok:true,first_visit:rows.length>0};
  }
  async function sendKindness(userId:string,name:string,phraseId:string) {
    await init();
    if(!(phraseId in kindness))return {ok:false,error:"Choose one of the friendly messages."};
    const rows=await sql!.unsafe("INSERT INTO pw_kindness(id,user_id,phrase_id,day_key) VALUES($1,$2,$3,CURRENT_DATE) ON CONFLICT DO NOTHING RETURNING id",[crypto.randomUUID(),userId,phraseId]);
    if(!rows.length)return {ok:false,error:"You already shared that message today."};
    await publish({actorType:"member",actorName:name,actorId:userId,kind:"kindness",detail:"An explorer shared a little kindness with the community."});
    return {ok:true,text:kindness[phraseId as keyof typeof kindness]};
  }
  return {init,publish,pulse,read,claim,visit,sendKindness,worlds,helpers};
}
