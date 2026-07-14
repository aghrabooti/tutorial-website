let currentUser = null;


const form = document.getElementById("profile-form");

const gradeSelect = document.getElementById("grade");

const majorSelect = document.getElementById("major");

const saveBtn = document.getElementById("save-btn");

const pageHeading = document.getElementById("page-heading");



gradeSelect.addEventListener("change", () => {

    if (gradeSelect.value === "9") {

        majorSelect.disabled = true;
        majorSelect.value = null;
        majorSelect.required = false;

    } else {

        majorSelect.disabled = false;
        majorSelect.required = true;

    }


    majorSelect.classList.toggle(
        "opacity-50",
        majorSelect.disabled
    );

});





async function fetchExistingData(){


    const token = localStorage.getItem(
        "session_token"
    );


    if(!token){

        window.location.href="login.html";
        return;

    }



    const sessionResult = await apiCall(
        "check-session",
        {
            token: token
        }
    );



    if(!sessionResult.valid){

        console.log("SESSION FAILED:", sessionResult);

        alert(JSON.stringify(sessionResult));

        return;

    }


    currentUser = sessionResult.user;



    document.getElementById("first-name").value =
    currentUser.first_name || "";



    document.getElementById("last-name").value =
    currentUser.last_name || "";



    if(currentUser.first_name){

        pageHeading.textContent =
        "ویرایش پروفایل تحصیلی";


        saveBtn.textContent =
        "بروزرسانی اطلاعات";

    }



    if(currentUser.grade){


        gradeSelect.value =
        currentUser.grade;



        gradeSelect.dispatchEvent(
            new Event("change")
        );



        if(
            currentUser.grade !== "9" &&
            currentUser.major
        ){

            majorSelect.value =
            currentUser.major;

        }

    }

}





form.addEventListener(
"submit",
async(e)=>{


    e.preventDefault();



    saveBtn.disabled=true;

    saveBtn.textContent =
    "در حال ذخیره...";



    const payload={


        token:
        localStorage.getItem(
            "session_token"
        ),


        first_name:
        document.getElementById(
            "first-name"
        ).value.trim(),


        last_name:
        document.getElementById(
            "last-name"
        ).value.trim(),


        grade:
        gradeSelect.value,


        major:
        gradeSelect.value==="9"
        ?
        null
        :
        majorSelect.value


    };




    const updateResult =
    await apiCall(
        "update-profile",
        payload
    );



    console.log(updateResult);



    if(updateResult.success){


        alert(
            "اطلاعات با موفقیت ذخیره شد"
        );


        window.location.href =
        "dashboard.html";


    }
    else{


        alert(
            updateResult.error ||
            "خطا در ذخیره اطلاعات"
        );


        saveBtn.disabled=false;


        saveBtn.textContent =
        "ثبت و ورود به داشبورد";

    }



});





document.addEventListener(
"DOMContentLoaded",
fetchExistingData
);