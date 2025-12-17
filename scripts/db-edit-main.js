
// Function to include HTML content from external files
function includeHTML() {
  const elements = document.querySelectorAll('[data-include]'); // Select all elements with the attribute

  elements.forEach(elmnt => {
    const file = elmnt.getAttribute('data-include');
    if (file) {
      fetch(file)
        .then(response => {
          if (response.ok) return response.text();
          throw new Error('Page not found.');
        })
        .then(text => {
          elmnt.innerHTML = text; // Insert the content
          elmnt.removeAttribute('data-include'); // Prevent infinite loops
          includeHTML(); // Check for nested includes
        })
        .catch(error => {
          elmnt.innerHTML = error.message;
        });
    }
  });
}

// Call the function when the page loads
document.addEventListener('DOMContentLoaded', includeHTML);
