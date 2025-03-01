// Add a little interactivity
document.querySelector(".animated-logo").addEventListener("click", function() {
    this.style.transform = "scale(1.3) rotate(720deg)";
    setTimeout(() => {
        this.style.transform = "scale(1.1) rotate(0deg)";
    }, 1000);
});
