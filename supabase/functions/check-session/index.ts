import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);



async function hashText(text:string){

  const encoder = new TextEncoder();

  const data = encoder.encode(text);


  const hashBuffer =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );


  return Array.from(
    new Uint8Array(hashBuffer)
  )
  .map(
    b=>b.toString(16).padStart(2,"0")
  )
  .join("");

}




Deno.serve(async(req)=>{


try{


const {
 token
}=await req.json();



if(!token){

return new Response(
JSON.stringify({
error:"توکن ارسال نشده"
}),
{
status:400
}
);

}



const tokenHash =
await hashText(token);





// پیدا کردن Session


const {data:session,error}=await supabaseAdmin
.from("user_sessions")
.select("*")
.eq("token_hash",tokenHash)
.eq("is_active",true)
.maybeSingle();





if(error || !session){

return new Response(
JSON.stringify({
error:"نشست معتبر نیست"
}),
{
status:401
}
);

}





// بررسی انقضا


if(
new Date(session.expires_at)
<
new Date()
){


await supabaseAdmin
.from("user_sessions")
.update({
is_active:false
})
.eq("id",session.id);



return new Response(
JSON.stringify({
error:"نشست منقضی شده"
}),
{
status:401
}
);

}





// گرفتن اطلاعات کاربر


const {data:user}=await supabaseAdmin
.from("site_users")
.select(
"id,phone,first_name,last_name,role"
)
.eq("id",session.user_id)
.single();





if(!user){

return new Response(
JSON.stringify({
error:"کاربر پیدا نشد"
}),
{
status:404
}
);

}




return new Response(
JSON.stringify({

success:true,

user

}),
{
status:200
}
);





}
catch(error){

return new Response(
JSON.stringify({
error:error.message
}),
{
status:500
}
);

}


});