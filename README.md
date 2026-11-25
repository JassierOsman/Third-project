# Custom models

Put `.glb` or `.gltf` files in this folder and open the app with:

```
index.html?model=assets/models/your-model.glb
```

- If your model is modelled in **metres**, no extra parameter is needed (1:1).
- If it is in another unit or scale, add `&modelScale=N`. For example, use `modelScale=70` for a model of a 1:70 maquette whose units are maquette metres, or `modelScale=0.01` for a model authored in centimetres.

See the main README section "Scale & transforms" for the maths.
