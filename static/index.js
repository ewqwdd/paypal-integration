window.addEventListener("load", () => {
  let toaster = new Toast({});

  const passwordInput = document.getElementById("password");

  const startLoading = () => {
    document.body.classList.add("animate-pulse");
    document.body.classList.add("pointer-events-none");
  };

  const endLoading = () => {
    document.body.classList.remove("animate-pulse");
    document.body.classList.remove("pointer-events-none");
  };

  const renderTables = (plans) => {
    const table = document.getElementById("table-body");

    table.innerHTML = "";
    plans.forEach((plan) => {
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = plan.name;
      name.className =
        "whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6";
      const description = document.createElement("td");
      description.textContent = plan.description;
      description.className =
        "whitespace-nowrap px-3 py-4 text-sm text-gray-500";
      const price = document.createElement("td");
      price.textContent = plan.price;
      price.className = "whitespace-nowrap px-3 py-4 text-sm text-gray-500";
      const planId = document.createElement("td");
      planId.textContent = plan.planId;
      planId.className = "whitespace-nowrap px-3 py-4 text-sm text-gray-500";
      const memberstackPlanId = document.createElement("td");
      memberstackPlanId.textContent = plan.memberstackPlanId;
      memberstackPlanId.className =
        "whitespace-nowrap py-4 pl-3 pr-4 text-sm font-medium sm:pr-6";
      tr.appendChild(name);
      tr.appendChild(description);
      tr.appendChild(price);
      tr.appendChild(planId);
      tr.appendChild(memberstackPlanId);
      table.appendChild(tr);
    });
  };

  const fetchTable = async () => {
    startLoading();
    const response = await fetch("/plans", {
      headers: {
        Authorization: passwordInput.value,
      },
    });
    if (!response.ok) {
      toaster.show("Error", { className: "toast-error" });
    } else {
      const json = await response.json();
      console.log(json);
      renderTables(json.plans);
    }
    endLoading();
  };

  const addPlan = async (
    name,
    description,
    price,
    interval,
    memberstackPlanId
  ) => {
    startLoading();
    const response = await fetch("/add-plan", {
      method: "POST",
      headers: {
        Authorization: passwordInput.value,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        plan: {
          name,
          description,
          price,
          interval,
        },
        product: {
          name,
          description,
        },
        memberstackPlanId,
      }),
    });
    if (!response.ok) {
      toaster.show("Error", { className: "toast-error" });
      endLoading();
    } else {
      toaster.show("Plan added", { className: "toast-success" });
      fetchTable();
    }
  };

  const fetchButton = document.getElementById("fetch-button");
  fetchButton.addEventListener("click", fetchTable);

  const addForm = document.getElementById("add-plan");
  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.querySelector('[name="name"]').value;
    const description = document.querySelector('[name="description"]').value;
    const price = document.querySelector('[name="price"]').value;
    const interval = document.querySelector('[name="interval"]').value;
    const memberstackPlanId = document.querySelector(
      '[name="memberstackPlanId"]'
    ).value;
    addPlan(name, description, price, interval, memberstackPlanId);
  });
});
