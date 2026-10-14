import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};

function jsonResponse(data: any, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    }
  );
}


const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);



async function sha256(text:string){

  const encoder = new TextEncoder();

  const hash =
  await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(text)
  );


  return Array.from(
    new Uint8Array(hash)
  )
  .map(
    b=>b.toString(16).padStart(2,"0")
  )
  .join("");

}



Deno.serve(async(req)=>{


  if(req.method==="OPTIONS"){

    return new Response(null,{
      status:204,
      headers:corsHeaders
    });

  }



  try{


    const body = await req.json();


    const {
      token,
      course_id
    } = body;



    if(!token || !course_id){

      return jsonResponse(
        {
          success:false,
          error:"اطلاعات ناقص است"
        },
        400
      );

    }




    // بررسی سشن

    const tokenHash =
    await sha256(token);



    const {data:session,error:sessionError}=

    await supabaseAdmin
    .from("user_sessions")
    .select(
      "user_id,is_active,expires_at"
    )
    .eq(
      "token_hash",
      tokenHash
    )
    .maybeSingle();



    if(
      sessionError ||
      !session ||
      !session.is_active ||
      new Date(session.expires_at)
      < new Date()
    ){

      return jsonResponse(
        {
          success:false,
          error:"جلسه معتبر نیست"
        },
        401
      );

    }




    // بررسی ادمین

    const {data:user}=

    await supabaseAdmin
    .from("site_users")
    .select("role")
    .eq(
      "id",
      session.user_id
    )
    .single();



    if(!user || user.role!=="admin"){

      return jsonResponse(
        {
          success:false,
          error:"دسترسی غیر مجاز"
        },
        403
      );

    }




    // ساخت اطلاعات آپدیت

    const fields = [
      "title",
      "grade",
      "category",
      "type",
      "description",
      "price",
      "discount_price",
      "image_url",
      "major"
    ];



    const updateData:any = {};



    fields.forEach(field=>{

      if(field in body){

        updateData[field] =
        body[field] === ""
        ? null
        : body[field];

      }

    });



    if(
      Object.keys(updateData).length===0
    ){

      return jsonResponse(
        {
          success:false,
          error:"هیچ تغییری ارسال نشده"
        },
        400
      );

    }




    const {error:updateError}=

    await supabaseAdmin
    .from("courses")
    .update(updateData)
    .eq(
      "id",
      course_id
    );




    if(updateError){

      console.error(updateError);

      return jsonResponse(
        {
          success:false,
          error:updateError.message
        },
        500
      );

    }




    return jsonResponse({

      success:true,

      message:
      "دوره با موفقیت بروزرسانی شد"

    });



  }
  catch(error){


    console.error(error);


    return jsonResponse(
      {
        success:false,
        error:
        error instanceof Error
        ?
        error.message
        :
        "خطای داخلی سرور"
      },
      500
    );


  }


});