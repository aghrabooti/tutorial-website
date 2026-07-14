import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function hashPassword(password: string) {

  const encoder = new TextEncoder();

  const salt = crypto.getRandomValues(
    new Uint8Array(16)
  );


  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );


  const hash = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    key,
    256
  );


  const saltHex = Array.from(salt)
    .map(b => b.toString(16).padStart(2,"0"))
    .join("");


  const hashHex = Array.from(
    new Uint8Array(hash)
  )
  .map(b => b.toString(16).padStart(2,"0"))
  .join("");


  return `${saltHex}:${hashHex}`;
}

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);



function normalizePhone(phone:string){

  phone = phone.trim()
  .replace(/\s+/g,"");


  if(phone.startsWith("09")){
    phone="98"+phone.substring(1);
  }


  if(phone.startsWith("+98")){
    phone=phone.substring(1);
  }


  return phone;

}




Deno.serve(async(req)=>{


try{


const {
 phone,
 password,
 first_name,
 last_name
}=await req.json();


if(!phone || !password || !first_name || !last_name){

return new Response(
JSON.stringify({
error:"اطلاعات ناقص است"
}),
{
status:400
}
);

}




if(password.length < 6){

return new Response(
JSON.stringify({
error:"رمز باید حداقل ۶ کاراکتر باشد"
}),
{
status:400
}
);

}





const normalizedPhone =
normalizePhone(phone);





// بررسی وجود کاربر


const {data:existingUser}=await supabaseAdmin
.from("site_users")
.select("id")
.eq("phone",normalizedPhone)
.maybeSingle();




if(existingUser){

return new Response(
JSON.stringify({
error:"این شماره قبلاً ثبت شده است"
}),
{
status:409
}
);

}






const passwordHash =
await hashPassword(password);







const {data:user,error}=await supabaseAdmin
.from("site_users")
.insert({

phone:normalizedPhone,

password_hash:passwordHash,

first_name,

last_name,

role:"student"

})
.select()
.single();





if(error){

console.error(error);


return new Response(
JSON.stringify({
error:"خطا در ساخت کاربر"
}),
{
status:500
}
);

}





return new Response(
JSON.stringify({

success:true,

user:{
id:user.id,
phone:user.phone,
full_name:user.full_name
}

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