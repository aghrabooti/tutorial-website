

    async function loadDashboardData(){


        const token =
        localStorage.getItem("session_token");



        if(!token){

            window.location.href="login.html";
            return;

        }




        const result =
        await apiCall(
            "check-session",
            {
                token
            }
        );




        console.log(result);




        if(!result.valid){


            localStorage.clear();

            window.location.href="login.html";

            return;

        }





        const user =
        result.user;







        document
        .getElementById("user-first-name")
        .textContent =
        user.first_name || "دانش‌آموز";







        const fullName =
        `${user.first_name || ""}
        ${user.last_name || ""}`;



        document
        .getElementById("profile-full-name")
        .textContent =
        fullName.trim() || "ثبت نشده";







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

        document.addEventListener(
            "DOMContentLoaded",
            loadDashboardData
            );

        document.getElementById("logout-btn").addEventListener(
    "click",
    async () => {

        localStorage.removeItem("session_token");

        window.location.href = "login.html";

    }
);

document.getElementById("logout-btn").addEventListener(
"click",
async()=>{

const token = localStorage.getItem("session_token");


await apiCall(
"logout-user",
{
token
}
);


localStorage.removeItem("session_token");


window.location.href="login.html";


});