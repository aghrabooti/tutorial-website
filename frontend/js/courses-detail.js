const supabaseClient = supabase.createClient(
    "https://qbsfotperzzhuimnpmto.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFic2ZvdHBlcnp6aHVpbW5wbXRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3MTM2NzIsImV4cCI6MjA5OTI4OTY3Mn0.N8Pv0hz3yKLcTVvwfiRlKW-yEE-d4vc1rkroZBglyTA"
);


const courseId = new URLSearchParams(
    window.location.search
).get("id");



async function loadCourseDetail(){

    if(!courseId){
        showError("شناسه دوره ارسال نشده است");
        return;
    }


    const id = courseId;


    const {
        data: course,
        error
    } = await supabaseClient
        .from("courses")
        .select("*")
        .eq("id", id)
        .single();



    if(error || !course){

        showError("دوره مورد نظر پیدا نشد");
        return;

    }


    renderCourse(course);

    await checkUserAccess(id);

}



function renderCourse(course){


    document.title =
    `${course.title} | آکادمی عزیزی`;



    document.getElementById(
        "course-title"
    ).textContent = course.title;



    document.getElementById(
        "price"
    ).textContent =
    course.price
    ?
    Number(course.price)
    .toLocaleString("fa-IR") + " تومان"
    :
    "رایگان";



    document.getElementById(
        "description"
    ).textContent =
    course.description ||
    "توضیحی برای این دوره ثبت نشده است";



    const badge =
    document.getElementById(
        "course-type-badge"
    );


    if(course.type === "seminar"){

        badge.textContent =
        "سمینار آموزشی";

    }
    else{

        badge.textContent =
        "دوره آموزشی";

    }





    if(course.image_url){


        const img =
        document.getElementById(
            "course-image"
        );


        const placeholder =
        document.getElementById(
            "course-image-placeholder"
        );



        img.src =
        course.image_url;


        img.alt =
        course.title;


        img.classList.remove(
            "hidden"
        );


        placeholder.classList.add(
            "hidden"
        );

    }

}




async function checkUserAccess(courseId){


    const token =
    localStorage.getItem(
        "session_token"
    );


    if(!token)
        return;



    try{


        const session =
        await apiCall(
            "check-session",
            {
                token
            }
        );



        if(!session.valid){


            localStorage.removeItem(
                "session_token"
            );


            return;

        }




        const authBtn =
        document.getElementById(
            "auth-btn"
        );



        if(authBtn){

            authBtn.textContent =
            "پنل کاربری";


            authBtn.href =
            "dashboard.html";

        }



        const {
            data: purchase
        } = await supabaseClient
            .from("user_purchases")
            .select("*")
            .eq(
                "user_id",
                session.user.id
            )
            .eq(
                "course_id",
                courseId
            )
            .maybeSingle();



        if(purchase){

            document
            .getElementById(
                "purchase-view"
            )
            .classList.add(
                "hidden"
            );


            document
            .getElementById(
                "content-view"
            )
            .classList.remove(
                "hidden"
            );


            document
            .getElementById(
                "buy-btn"
            )
            .classList.add(
                "hidden"
            );


            document
            .getElementById(
                "purchased-info"
            )
            .classList.remove(
                "hidden"
            );


            loadCourseContent();

        }



    }
    catch(error){

        console.error(error);

    }

}





function loadCourseContent(){


    document.getElementById(
        "course-content"
    ).innerHTML = `

    <div class="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl text-sm font-bold">

    ✓ دسترسی شما تایید شد. محتوای دوره فعال است.

    </div>


    <p class="text-gray-600 text-sm leading-relaxed">

    جلسات آموزشی دوره در این بخش قرار می‌گیرند.

    </p>

    `;

}





function showError(message){


    const box =
    document.getElementById(
        "description"
    );


    if(box){

        box.textContent =
        message;


        box.className =
        "text-red-500 font-bold";

    }

}




function initMobileMenu(){


    const btn =
    document.getElementById(
        "menu-toggle-btn"
    );


    const menu =
    document.getElementById(
        "mobile-menu"
    );



    if(!btn || !menu)
        return;



    btn.addEventListener(
        "click",
        ()=>{

            menu.classList.toggle(
                "hidden"
            );

        }
    );



    menu.querySelectorAll("a")
    .forEach(link=>{

        link.addEventListener(
            "click",
            ()=>{

                menu.classList.add(
                    "hidden"
                );

            }
        );

    });


}





document.addEventListener(
"DOMContentLoaded",
()=>{

    loadCourseDetail();

    initMobileMenu();

});
