// A fresh owner with nothing logged: screenshot the empty light table, fridge and gear.
export default async function (h) {
	const { setupOwner, goto, sleep, shot, check } = h;
	const a = await setupOwner();
	for (const [name, path] of [['home', '/photography/lab/'], ['fridge', '/photography/lab/fridge/'], ['gear', '/photography/lab/gear/']]) {
		await goto(a, path);
		await sleep(2600);
		await shot(a, `e-${name}`, { width: 1280, height: 1100, light: true });
	}
	check('empty states shot', true);
}
