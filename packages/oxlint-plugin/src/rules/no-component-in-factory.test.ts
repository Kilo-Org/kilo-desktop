import { ruleTester } from "../test/rule-tester.ts";
import noComponentInFactory from "./no-component-in-factory.ts";

ruleTester.run("no-component-in-factory", noComponentInFactory, {
	valid: [
		"export function Pane() { const [a] = useState(0); return <div>{a}</div>; }",
		"function Outer() { function Inner() { useState(0); return null; } return <Inner />; }",
		"function create(services) { return (props) => <Pane {...props} services={services} />; }",
		"function create(services) { const Wrapped = (props) => <Pane {...props} />; return Wrapped; }",
		'function create() { return function Grid() { "use no memo"; useState(0); return null; }; }',
	],
	invalid: [
		{
			code: "function createPane(services) { return function Pane() { const [a] = useState(services); return <div>{a}</div>; }; }",
			errors: [{ message: /Pane is defined inside createPane/ }],
		},
		{
			code: "function withQueries(Component) { const WithQueries = (props) => { useQuery(); return <Component {...props} />; }; return WithQueries; }",
			errors: 1,
		},
		{
			code: "function make() { return memo(function Row() { useState(0); return null; }); }",
			errors: 1,
		},
	],
});
