async function loadDashboardData(){


    const token =
    localStorage.getItem("session_token");


    if(!token){

        window.location.href =
        "login.html";

        return;

    }



    try{


        const result =
        await apiCall(
            "check-session",
            {
                token
            }
        );



        if(!result.valid){


            localStorage.clear();

            window.location.href =
            "login.html";

            return;

        }




        const user =
        result.user;



        await loadPurchasedCourses();




        document
        .getElementById("user-first-name")
        .textContent =
        user.first_name || "دانش‌آموز";




        document
        .getElementById("profile-full-name")
        .textContent =
        `${user.first_name || ""} ${user.last_name || ""}`.trim()
        ||
        "ثبت نشده";




        document
        .getElementById("profile-phone")
        .textContent =
        user.phone || "-";




        let gradeText="-";


        if(user.grade==="9")
            gradeText="نهم";

        else if(user.grade==="10")
            gradeText="دهم";

        else if(user.grade==="11")
            gradeText="یازدهم";

        else if(user.grade==="12")
            gradeText="دوازدهم";



        document
        .getElementById("profile-grade")
        .textContent =
        gradeText;





        let majorText =
        user.major || "-";



        if(user.major==="ریاضی")
            majorText="ریاضی فیزیک";


        else if(user.major==="تجربی")
            majorText="علوم تجربی";


        else if(user.major==="انسانی")
            majorText="علوم انسانی";




        document
        .getElementById("profile-field")
        .textContent =
        majorText;



    }
    catch(error){

        console.error(error);

    }


}





async function loadPurchasedCourses(){


    const token =
    localStorage.getItem("session_token");



    try{


        const result =
        await apiCall(
            "get-my-courses",
            {
                token
            }
        );



        if(!result.success){


            console.error(
                result.error
            );


            return;

        }



        renderPurchasedCourses(
            result.courses
        );



    }
    catch(error){

        console.error(error);

    }


}







function renderPurchasedCourses(items){


    const container =
    document.getElementById(
        "purchased-courses-container"
    );



    if(!container)
        return;




    if(!items || items.length===0){


        container.innerHTML = `

        <div class="col-span-full text-center py-10">

            <p class="text-gray-400">
            هنوز دوره‌ای خریداری نکرده‌اید
            </p>

        </div>

        `;


        return;

    }





    container.innerHTML="";




    items.forEach(item=>{


        const course =
        item.courses;



        if(!course)
            return;




        container.innerHTML += `


        <div class="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">


            <img
            src="${course.image_url || ''}"
            class="w-full h-40 object-cover rounded-xl mb-4">



            <h3 class="font-black text-lg text-gray-900">

                ${course.title}

            </h3>



            <p class="text-sm text-gray-500 mt-2">

                ${course.description || ""}

            </p>



            <a
            href="/frontend/pages/courses-detail.html?id=${course.id}"
            class="block mt-4 text-indigo-600 font-bold text-sm">

            مشاهده
            </a>



        </div>


        `;



    });



}







async function logout(){


    const token =
    localStorage.getItem("session_token");



    try{


        if(token){

            await apiCall(
                "logout-user",
                {
                    token
                }
            );

        }


    }
    catch(error){

        console.error(error);

    }




    localStorage.removeItem(
        "session_token"
    );



    window.location.href =
    "login.html";


}







document.addEventListener(
"DOMContentLoaded",
()=>{


    loadDashboardData();



    const logoutBtn =
    document.getElementById(
        "logout-btn"
    );



    if(logoutBtn){


        logoutBtn.addEventListener(
            "click",
            logout
        );


    }


});