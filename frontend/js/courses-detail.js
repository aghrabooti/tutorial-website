const courseId =
new URLSearchParams(
    window.location.search
).get("id");



async function loadCourseDetail(){


    if(!courseId){

        showError("شناسه دوره ارسال نشده است");
        return;

    }



    try{


        const course =
        await getCourse(courseId);



        if(!course){

            showError("دوره پیدا نشد");
            return;

        }



        renderCourse(course);



        await checkUserAccess(course.id);



    }
    catch(error){

        console.error(error);

        showError("خطا در دریافت اطلاعات دوره");

    }


}







async function getCourse(id){


    const response =
    await apiCall(
        "get-course",
        {
            course_id:id
        }
    );



    if(!response.success)
        return null;



    return response.course;


}







function renderCourse(course){


    document.title =
    `${course.title} | آکادمی عزیزی`;



    document.getElementById(
        "course-title"
    ).textContent =
    course.title;



    document.getElementById(
        "description"
    ).textContent =
    course.description ||
    "توضیحی ثبت نشده است";



    document.getElementById(
        "price"
    ).textContent =
    course.price
    ?
    Number(course.price)
    .toLocaleString("fa-IR")
    +" تومان"
    :
    "رایگان";




    const badge =
    document.getElementById(
        "course-type-badge"
    );



    if(badge){

        badge.textContent =
        course.type==="course"
        ?
        "دوره آموزشی"
        :
        "فایل آموزشی";

    }





    const img =
    document.getElementById(
        "course-image"
    );



    const placeholder =
    document.getElementById(
        "course-image-placeholder"
    );



    if(course.image_url && img){


        img.src =
        course.image_url;


        img.classList.remove(
            "hidden"
        );


        if(placeholder){

            placeholder.classList.add(
                "hidden"
            );

        }

    }





    const buyBtn =
    document.getElementById(
        "buy-btn"
    );



    if(buyBtn){


        buyBtn.onclick = ()=>{

            addToCart(course.id);

        };


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


        const result =
        await apiCall(
            "check-course-access",
            {
                token,
                course_id:courseId
            }
        );



        if(!result.success)
            return;



        if(result.purchased){


            hidePurchaseBox();



            await showPurchasedContent(
                result.course
            );


        }



    }
    catch(error){

        console.error(error);

    }


}









function hidePurchaseBox(){


    const price =
    document.getElementById(
        "price"
    );


    const buyBtn =
    document.getElementById(
        "buy-btn"
    );



    if(price){

        price.parentElement.remove();

    }



    if(buyBtn){

        buyBtn.remove();

    }


}









async function showPurchasedContent(course){


    const content =
    document.getElementById(
        "course-content"
    );



    if(!content)
        return;





    document
    .getElementById(
        "purchase-view"
    )
    ?.classList.add(
        "hidden"
    );



    document
    .getElementById(
        "content-view"
    )
    ?.classList.remove(
        "hidden"
    );







    // دوره ویدیویی

    if(course.type==="course"){



        const token =
        localStorage.getItem(
            "session_token"
        );



        const result =
        await apiCall(
            "get-course-sessions",
            {
                token,
                course_id:course.id
            }
        );



        if(!result.success){


            content.innerHTML = `

            <div class="text-red-500 font-bold">

            خطا در دریافت جلسات

            </div>

            `;


            return;

        }





        if(!result.sessions ||
           result.sessions.length===0){


            content.innerHTML = `

            <div class="text-gray-500">

            هنوز جلسه‌ای برای این دوره ثبت نشده است.

            </div>

            `;


            return;

        }





        let html="";



        result.sessions.forEach(session=>{


            html += `

            <div class="bg-white border rounded-2xl p-5">


                <h4 class="font-black text-lg">

                    جلسه ${session.session_number}
                    -
                    ${session.title}

                </h4>



                <button

                onclick="playVideo('${session.video_url}')"

                class="mt-4 bg-indigo-600 text-white px-5 py-2 rounded-xl">

                    پخش ویدیو

                </button>


            </div>


            `;


        });





        content.innerHTML = `


        <div class="space-y-5">


            <h3 class="text-xl font-black">

            جلسات دوره

            </h3>


            ${html}


        </div>


        `;



    }







    // فایل آموزشی

    else{


        content.innerHTML = `


        <div class="bg-white border rounded-2xl p-6">


            <h3 class="font-black text-xl">

            فایل آموزشی

            </h3>



            <button

            class="mt-5 bg-green-600 text-white px-6 py-3 rounded-xl">

            دانلود فایل

            </button>


        </div>


        `;


    }



}









async function addToCart(courseId){


    const token =
    localStorage.getItem(
        "session_token"
    );



    if(!token){

        window.location.href="login.html";
        return;

    }



    const result =
    await apiCall(
        "add-to-cart",
        {
            token,
            course_id:courseId
        }
    );



    if(!result.success){

        alert(result.error);
        return;

    }



    window.location.href="cart.html";


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








document.addEventListener(
"DOMContentLoaded",
()=>{


    loadCourseDetail();


});

function playVideo(url){

    const content =
    document.getElementById(
        "course-content"
    );


    content.innerHTML = `

    <div class="bg-black rounded-2xl overflow-hidden aspect-video">

        <iframe

        src="${url}"

        class="w-full h-full"

        frameborder="0"

        allowfullscreen>

        </iframe>

    </div>

    <button
    onclick="location.reload()"
    class="mt-4 bg-gray-200 px-4 py-2 rounded-xl">

        بازگشت به جلسات

    </button>

    `;

}