import { createClient } from "https://esm.sh/@supabase/supabase-js@2";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};



function jsonResponse(data:any, status=200){

  return new Response(
    JSON.stringify(data),
    {
      status,
      headers:{
        ...corsHeaders,
        "Content-Type":"application/json"
      }
    }
  );

}



const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);





async function verifyPassword(
  password:string,
  storedHash:string
){

  const parts = storedHash.split(":");


  if(parts.length !== 2){
    return false;
  }


  const saltHex = parts[0];
  const originalHash = parts[1];



  const salt = new Uint8Array(
    saltHex.match(/.{1,2}/g)!
      .map(byte=>parseInt(byte,16))
  );



  const encoder = new TextEncoder();



  const key =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );



  const hash =
    await crypto.subtle.deriveBits(
      {
        name:"PBKDF2",
        salt,
        iterations:100000,
        hash:"SHA-256"
      },
      key,
      256
    );



  const hashHex =
    Array.from(
      new Uint8Array(hash)
    )
    .map(
      b=>b.toString(16).padStart(2,"0")
    )
    .join("");



  return hashHex === originalHash;

}







function normalizePhone(phone:string){

  phone =
    phone.trim()
    .replace(/\s+/g,"");



  if(phone.startsWith("09")){

    phone =
      "98" + phone.substring(1);

  }



  if(phone.startsWith("+98")){

    phone =
      phone.substring(1);

  }


  return phone;

}







async function hashText(text:string){


  const encoder = new TextEncoder();


  const data =
    encoder.encode(text);



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


  // CORS preflight

  if(req.method==="OPTIONS"){

    return new Response(
      "ok",
      {
        headers:corsHeaders
      }
    );

  }





  try{


    const {
      phone,
      password
    } = await req.json();





    if(!phone || !password){

      return jsonResponse(
        {
          error:"اطلاعات ناقص است"
        },
        400
      );

    }





    const normalizedPhone =
      normalizePhone(phone);






    // پیدا کردن کاربر


    const {
      data:user,
      error
    } = await supabaseAdmin
      .from("site_users")
      .select("*")
      .eq(
        "phone",
        normalizedPhone
      )
      .maybeSingle();






    if(error || !user){

      return jsonResponse(
        {
          error:"شماره یا رمز اشتباه است"
        },
        401
      );

    }







    if(!user.is_active){

      return jsonResponse(
        {
          error:"حساب کاربری غیرفعال است"
        },
        403
      );

    }








    // بررسی رمز


    const passwordCorrect =
      await verifyPassword(
        password,
        user.password_hash
      );





    if(!passwordCorrect){


      return jsonResponse(
        {
          error:"شماره یا رمز اشتباه است"
        },
        401
      );

    }








    // ساخت Token خام


    const token =
      crypto.randomUUID()
      +
      crypto.randomUUID();







    // Hash Token


    const tokenHash =
      await hashText(token);







    // ساخت Session


    const {
      error:sessionError
    } = await supabaseAdmin
      .from("user_sessions")
      .insert({

        user_id:user.id,

        token_hash:tokenHash,

        expires_at:
          new Date(
            Date.now()
            +
            30*24*60*60*1000
          )

      });







    if(sessionError){


      return jsonResponse(
        {
          error:"خطا در ساخت نشست"
        },
        500
      );

    }








    // ثبت آخرین ورود


    await supabaseAdmin
      .from("site_users")
      .update({

        last_login:new Date()

      })
      .eq(
        "id",
        user.id
      );









    return jsonResponse(
    {
        success:true,

        token,

        user:{

        id:user.id,

        phone:user.phone,

        first_name:user.first_name,

        last_name:user.last_name,

        grade:user.grade,

        major:user.major,

        role:user.role

        }

    },
    200
    );





  }
  catch(error){


    return jsonResponse(
      {
        error:error.message
      },
      500
    );


  }


});